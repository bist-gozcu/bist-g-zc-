import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import DecisionCard from "@/components/DecisionCard";
import { useMarketData } from "@/hooks/useMarketData";
import {
  getTop6TreydWithConfirmation,
  TreydSinyali,
} from "@/services/treydMotoru";
import { isPiyasaAcik } from "@/utils/seansKontrol";
import { fireRadarNotifications } from "@/contexts/AlertContext";
import { useDemo } from "@/contexts/DemoContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import { IconEnvelope } from "@/components/TabIcon";

const RADAR_NOTIFICATION_KEY = "bist_trend_radar_notifications_v1";
const RADAR_SEEN_KEY = "bist_trend_radar_seen_v1";

const localDateKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function TreydScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, isFetching, error, manuelYenile } =
    useMarketData("bist100");
  const { syncSignals, prepareMorningCandidates } = useDemo();
  const { favorites, ready: favoritesReady } = useFavorites();
  const [results, setResults] = useState<TreydSinyali[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /* ── notification envelope state ── */
  const [notifiedSymbols, setNotifiedSymbols] = useState<Set<string>>(new Set());
  const [seenSymbols, setSeenSymbols] = useState<Set<string>>(new Set());

  const marketOpen = isPiyasaAcik();

  /* load notified + seen from AsyncStorage */
  useEffect(() => {
    const load = async () => {
      try {
        const today = localDateKey();
        const [rawNotif, rawSeen] = await Promise.all([
          AsyncStorage.getItem(RADAR_NOTIFICATION_KEY),
          AsyncStorage.getItem(RADAR_SEEN_KEY),
        ]);
        const notifState: Record<string, { date: string; stage: number }> = rawNotif ? JSON.parse(rawNotif) : {};
        const seenState: Record<string, string> = rawSeen ? JSON.parse(rawSeen) : {};
        const todayNotif = new Set(
          Object.entries(notifState)
            .filter(([, v]) => v.date === today)
            .map(([k]) => k),
        );
        const todaySeen = new Set(
          Object.entries(seenState)
            .filter(([, v]) => v === today)
            .map(([k]) => k),
        );
        setNotifiedSymbols(todayNotif);
        setSeenSymbols(todaySeen);
      } catch {
        /* ignore */
      }
    };
    void load();
  }, [hasScanned]);

  const markSeen = useCallback(async (symbol: string) => {
    try {
      const today = localDateKey();
      const rawSeen = await AsyncStorage.getItem(RADAR_SEEN_KEY);
      const seenState: Record<string, string> = rawSeen ? JSON.parse(rawSeen) : {};
      seenState[symbol] = today;
      const entries = Object.entries(seenState).slice(-200);
      await AsyncStorage.setItem(RADAR_SEEN_KEY, JSON.stringify(Object.fromEntries(entries)));
      setSeenSymbols((prev) => {
        const next = new Set(prev);
        next.add(symbol);
        return next;
      });
    } catch {
      /* ignore */
    }
  }, []);

  /* results is already sorted by genelPuan desc from getTop6TreydWithConfirmation */

  const scan = useCallback(async () => {
    if (!data || isScanning || isRefreshing) return;

    setIsScanning(true);
    try {
      const confirmedResults = await getTop6TreydWithConfirmation(data);
      setResults(confirmedResults);
      setHasScanned(true);
      if (!marketOpen) {
        prepareMorningCandidates(
          confirmedResults
            .filter((item) => favorites.includes(item.sembol))
            .filter((item) => item.genelPuan >= 50)
            .map((item) => ({
              symbol: item.sembol,
              price: item.fiyat,
              signalType:
                item.durumEtiketi === "Teyitli"
                  ? ("gunluk_teyitli" as const)
                  : item.durumEtiketi === "Kırılım"
                    ? ("kirilim_ani" as const)
                    : item.durumEtiketi === "Çekirge"
                      ? ("cekirge_adayi" as const)
                      : ("erken_hareket" as const),
              score: item.genelPuan,
              confirmations: item.teyitSayisi,
              dailyTrend: item.gunlukTrend,
              dailyChange: item.degisimYuzde,
            })),
        );
      }
      void fireRadarNotifications(
        confirmedResults.map((item) => ({
          symbol: item.sembol,
          price: item.fiyat,
          changePercent: item.degisimYuzde,
          teyitSayisi: item.teyitSayisi,
          teyitler: item.teyitler,
          radarDurumu: item.radarDurumu,
          veriKalitesi: item.veriKalitesi,
        })),
      );
    } finally {
      setIsScanning(false);
    }
  }, [
    data,
    favorites,
    favoritesReady,
    isScanning,
    isRefreshing,
    marketOpen,
    prepareMorningCandidates,
  ]);

  const refreshAndScan = useCallback(async () => {
    if (isRefreshing || isScanning) return;
    setHasScanned(false);
    setIsRefreshing(true);
    try {
      await manuelYenile();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, isScanning, manuelYenile]);

  useEffect(() => {
    if (data && !hasScanned && !isScanning && !isRefreshing) void scan();
  }, [
    data,
    favorites,
    favoritesReady,
    hasScanned,
    isScanning,
    isRefreshing,
    scan,
  ]);

  useEffect(() => {
    if (!favoritesReady) return;
    setHasScanned(false);
  }, [favorites, favoritesReady]);

  useEffect(() => {
    if (!marketOpen) return;
    const timer = setInterval(
      () => {
        void refreshAndScan();
      },
      5 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, [marketOpen, refreshAndScan]);

  const demoSignalSignature = useMemo(
    () =>
      results
        .filter((item) => item.genelPuan >= 50)
        .map(
          (item) =>
            `${item.sembol}-${item.durumEtiketi}-${item.teyitSayisi}-${item.genelPuan}`,
        )
        .join("|"),
    [results],
  );

  useEffect(() => {
    if (!hasScanned || isScanning || !demoSignalSignature) return;
    const demoSignals = results
      .filter((item) => item.genelPuan >= 50)
      .map((item) => ({
        symbol: item.sembol,
        price: item.fiyat,
        signalType:
          item.durumEtiketi === "Teyitli"
            ? ("gunluk_teyitli" as const)
            : item.durumEtiketi === "Kırılım"
              ? ("kirilim_ani" as const)
              : ("erken_hareket" as const),
        score: item.genelPuan,
        confirmations: item.teyitSayisi,
        dailyTrend: item.gunlukTrend,
      }));
    const prices = Object.fromEntries(
      (data ?? []).map((item) => [item.sembol, item.fiyat]),
    );
    syncSignals(demoSignals, prices, marketOpen);
  }, [
    data,
    demoSignalSignature,
    hasScanned,
    isScanning,
    marketOpen,
    results,
    syncSignals,
  ]);

  const sessionLabel = useMemo(
    () =>
      marketOpen
        ? "Piyasa açık · canlı tarama mümkün"
        : "Piyasa kapalı · son veri gösteriliyor",
    [marketOpen],
  );
  const scanBusy = isFetching || isScanning || isRefreshing;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border },
          { paddingTop: insets.top + 10 },
        ]}
      >
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            TREND
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              void refreshAndScan();
            }}
            disabled={scanBusy}
            style={[
              styles.refreshButton,
              { backgroundColor: scanBusy ? colors.border : colors.secondary },
            ]}
          >
            <Text
              style={[
                styles.refreshText,
                { color: scanBusy ? colors.mutedForeground : colors.primary },
              ]}
            >
              Yenile
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={[
          styles.sessionBanner,
          {
            backgroundColor: marketOpen
              ? `${colors.up}18`
              : `${colors.neutral}18`,
            borderColor: marketOpen ? `${colors.up}44` : `${colors.neutral}44`,
          },
        ]}
      >
        <View
          style={[
            styles.sessionDot,
            { backgroundColor: marketOpen ? colors.up : colors.neutral },
          ]}
        />
        <Text style={[styles.sessionText, { color: colors.foreground }]}>
          {sessionLabel}
        </Text>
      </View>

      <FlatList<TreydSinyali>
        data={results}
        keyExtractor={(item) => item.sembol}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshing={scanBusy}
        onRefresh={() => void refreshAndScan()}
        ListHeaderComponent={
          results.length > 0 ? (
            <View
              style={[
                styles.listHeader,
                { backgroundColor: colors.background },
              ]}
            >
              <Text
                style={[styles.listHeaderTitle, { color: colors.foreground }]}
              >
                Trend Adayları
              </Text>
              <Text
                style={[styles.listHeaderCount, { color: colors.mutedForeground }]}
              >
                {results.length} aday
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const hasNotif = notifiedSymbols.has(item.sembol) && !seenSymbols.has(item.sembol);
          return (
            <View style={styles.resultRow}>
              <View style={[styles.rank, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.rankText, { color: colors.primary }]}>
                  #{index + 1}
                </Text>
              </View>
              <View style={styles.resultCard}>
                <DecisionCard
                  sembol={item.sembol}
                  skor={item.skor}
                  guncelFiyat={item.fiyat}
                  gunlukDegisim={item.degisimYuzde}
                  onPress={() => {
                    if (hasNotif) void markSeen(item.sembol);
                    router.push({
                      pathname: "/stock/[symbol]",
                      params: { symbol: item.sembol },
                    });
                  }}
                  etiket={item.etiket}
                  teyitSayisi={item.teyitSayisi}
                  toplamTeyit={item.toplamTeyit}
                  trendTeyitli={item.trendTeyitli}
                  gunlukTrend={item.gunlukTrend}
                  direnc={item.direnc}
                  direncKirildi={item.direncKirildi}
                  hacimTeyitli={item.hacimTeyitli}
                  ema20={item.ema20}
                  obvDirection={item.obvDirection}
                  obvTeyitli={item.obvTeyitli}
                  rsiValue={item.rsiValue}
                  rsiUygun={item.rsiUygun}
                  yuksekDip={item.yuksekDip}
                  yuksekTepe={item.yuksekTepe}
                  yapiTeyitli={item.yapiTeyitli}
                  teyitler={item.teyitler}
                  radarDurumu={item.radarDurumu}
                  erkenHareketSkoru={item.erkenHareketSkoru}
                  erkenHareketEtiketi={item.erkenHareketEtiketi}
                  erkenHareketNedenleri={item.erkenHareketNedenleri}
                  piyasaHavasi={item.piyasaHavasi}
                  genelPuan={item.genelPuan}
                  durumEtiketi={item.durumEtiketi}
                  cekirgeUygun={item.cekirgeUygun}
                  cekirgeSkoru={item.cekirgeSkoru}
                  cekirgeNedenleri={item.cekirgeNedenleri}
                  cekirgeRiski={item.cekirgeRiski}
                  kirilimAniSkoru={item.kirilimAniSkoru}
                  kirilimAniNedenleri={item.kirilimAniNedenleri}
                  kirilimSaptandi={item.kirilimSaptandi}
                  sikismaAktif={item.sikismaAktif}
                  sikismaSuresi={item.sikismaSuresi}
                  sikismaPatladi={item.sikismaPatladi}
                  sikismaSkoru={item.sikismaSkoru}
                  sikismaNedenleri={item.sikismaNedenleri}
                  oneriAlisSeviyesi={item.oneriAlisSeviyesi}
                  oneriHedefFiyat={item.oneriHedefFiyat}
                  oneriStopSeviyesi={item.oneriStopSeviyesi}
                  beklenenKarOrani={item.beklenenKarOrani}
                  riskOdulOrani={item.riskOdulOrani}
                  bbBandwidth={item.bbBandwidth}
                  momentumYonu={item.momentumYonu}
                  hasUnseenNotification={hasNotif}
                />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: colors.border }]}>
            {isLoading || isFetching || isScanning ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {error
                    ? "Veri alınamadı"
                    : hasScanned
                      ? "Radar sonucu bulunamadı"
                      : "Radar taraması hazırlanıyor"}
                </Text>
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  {error
                    ? "Bağlantıyı kontrol edip aşağı çekerek yeniden deneyin."
                    : "Yeterli likidite ve genel puanı yüksek adaylar burada görünür."}
                </Text>
              </>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  refreshButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  refreshText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sessionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 12,
    marginBottom: 4,
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  sessionDot: { width: 7, height: 7, borderRadius: 4 },
  sessionText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  listContent: { paddingHorizontal: 12, paddingTop: 6 },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 8,
  },
  listHeaderTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  listHeaderCount: { fontSize: 11, fontFamily: "Inter_500Medium" },
  resultRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 10,
  },
  rank: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  rankText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  resultCard: { flex: 1 },
  empty: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: 20,
  },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
