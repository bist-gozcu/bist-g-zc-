// Dosya: utils/twelveData.ts
//
// Yahoo Finance günlük grafiğinde bir önceki seansın kapanışı boş (null)
// geldiğinde yüzde değişim yanlış hesaplanabiliyor (ör. YKBNK +%12.83 gibi
// BIST ±%10 marjını aşan değerler). Bu modül, alternatif bir ÜCRETSİZ veri
// kaynağı olan Twelve Data'dan (Borsa İstanbul / XIST kapsamında) temiz
// previous_close + percent_change çekerek bu şüpheli satırları onarır.
//
// Twelve Data ücretsiz plan: ömür boyu ücretsiz anahtar, 800 istek/gün, 8 istek/dk.
// Anahtar https://twelvedata.com/pricing adresinden 10 saniyede alınır ve
// .env içine EXPO_PUBLIC_TWELVEDATA_KEY olarak eklenir. Anahtar yoksa modül
// sessizce devre dışı kalır (Yahoo verisi kullanılmaya devam eder).

import { logger } from "@/utils/logger";

export type AltQuote = {
  sembol: string;
  fiyat: number;
  degisimYuzde: number;
  oncekiKapanis: number;
  hacim: number;
};

const TD_BASE = "https://api.twelvedata.com";
const TD_TIMEOUT_MS = 10_000;
// Twelve Data ücretsiz plan tek çağrıda en fazla 120 sembol batch destekler;
// biz onarım amaçlı az sayıda sembol gönderdiğimiz için güvenli sınır.
const TD_MAX_BATCH = 100;

export const getTwelveDataKey = (): string | null => {
  const key = process.env.EXPO_PUBLIC_TWELVEDATA_KEY?.trim();
  return key && key.length > 0 ? key : null;
};

export const isTwelveDataEnabled = (): boolean => getTwelveDataKey() !== null;

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

async function fetchWithTimeout(
  url: string,
  timeoutMs = TD_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type TDQuoteRecord = {
  symbol?: unknown;
  close?: unknown;
  previous_close?: unknown;
  percent_change?: unknown;
  volume?: unknown;
  code?: unknown; // hata durumunda
  status?: unknown;
};

const normalizeRecord = (
  fallbackSymbol: string,
  record: TDQuoteRecord,
): AltQuote | null => {
  if (record.status === "error" || record.code) return null;
  const sembol = String(record.symbol ?? fallbackSymbol)
    .replace(/\.IS$/i, "")
    .toUpperCase();
  const fiyat = toNumber(record.close);
  const oncekiKapanis = toNumber(record.previous_close);
  if (fiyat <= 0) return null;
  const degisimYuzde =
    toNumber(record.percent_change) ||
    (oncekiKapanis > 0 ? ((fiyat - oncekiKapanis) / oncekiKapanis) * 100 : 0);
  return {
    sembol,
    fiyat,
    degisimYuzde,
    oncekiKapanis,
    hacim: toNumber(record.volume),
  };
};

/**
 * Verilen BIST sembolleri için Twelve Data'dan quote çeker. Anahtar yoksa veya
 * hata olursa boş Map döner (çağıran taraf Yahoo verisiyle devam eder).
 * Sonuç sembol -> AltQuote eşlemesidir.
 */
export async function fetchTwelveDataQuotes(
  symbols: string[],
): Promise<Map<string, AltQuote>> {
  const out = new Map<string, AltQuote>();
  const key = getTwelveDataKey();
  if (!key || symbols.length === 0) return out;

  const clean = Array.from(
    new Set(
      symbols.map((s) => s.replace(/\.IS$/i, "").trim().toUpperCase()),
    ),
  ).filter((s) => s.length > 0);

  for (let i = 0; i < clean.length; i += TD_MAX_BATCH) {
    const batch = clean.slice(i, i + TD_MAX_BATCH);
    const symbolParam = encodeURIComponent(batch.join(","));
    const url =
      `${TD_BASE}/quote?symbol=${symbolParam}` +
      `&exchange=BIST&apikey=${encodeURIComponent(key)}`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        logger.warn("twelveData", `Quote isteği başarısız (HTTP ${res.status})`);
        continue;
      }
      const payload = (await res.json()) as
        | TDQuoteRecord
        | Record<string, TDQuoteRecord>;

      // Tek sembolde düz obje, çok sembolde sembol-anahtarlı obje döner.
      if (batch.length === 1) {
        const q = normalizeRecord(batch[0], payload as TDQuoteRecord);
        if (q) out.set(q.sembol, q);
      } else {
        for (const sym of batch) {
          const rec = (payload as Record<string, TDQuoteRecord>)[sym];
          if (!rec) continue;
          const q = normalizeRecord(sym, rec);
          if (q) out.set(q.sembol, q);
        }
      }
    } catch (e) {
      logger.warn("twelveData", "Quote batch hatası", e);
    }
  }

  return out;
}
