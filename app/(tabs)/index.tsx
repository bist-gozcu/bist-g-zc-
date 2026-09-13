import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useStocks } from "@/contexts/StockContext";
import { useWatchlist } from "@/contexts/WatchlistContext";
import { UNIQUE_BIST_STOCKS } from "@/constants/bistStocks";
import StockRow from "@/components/StockRow";
import {
  IconRefresh,
  IconChevronUp,
  IconChevronDown,
  IconTrash,
  IconPlus,
  IconX,
} from "@/components/TabIcon";
import { useIsFocused } from "@react-navigation/native";

type SortKey = "name" | "price" | "change" | "volume";
type SortDir = "asc" | "desc";

/* ── swipe silme alanı genişliği ── */
const DELETE_ACTION_WIDTH = 76;

/* ── swipe-to-delete satır bileşeni ── */
const MarketRow = React.forwardRef(function MarketRow(
  {
    symbol,
    quote,
    onRemove,
    onSwipeOpen,
    onSwipeClose,
  }: {
    symbol: string;
    quote: any;
    onRemove: () => void;
    onSwipeOpen: () => void;
    onSwipeClose: () => void;
  },
  ref: React.Ref<any>,
) {
  const colors = useColors();
  const swipeRef = useRef<Swipeable>(null);

  /* dışarıya close() metodu ver */
  React.useImperativeHandle(ref, () => ({
    close: () => swipeRef.current?.close(),
  }));

  const renderRightActions = () => (
    <Pressable
      style={[styles.swipeDelete, { backgroundColor: colors.purple }]}
      onPress={() => {
        swipeRef.current?.close();
        onRemove();
      }}
    >
      <IconTrash color="#fff" size={18} />
      <Text style={styles.swipeDeleteText}>Sil</Text>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
      onSwipeableWillOpen={onSwipeOpen}
      onSwipeableWillClose={onSwipeClose}
    >
      <StockRow symbol={symbol} quote={quote} />
    </Swipeable>
  );
});

export default function MarketScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { quotes, loading, refresh, lastUpdated, isMarketOpen } = useStocks();
  const { watchlist, addToWatchlist, removeFromWatchlist, reorder } = useWatchlist();
  const [sortKey, setSortKey] = useState<SortKey>("change");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  /* ── swipeable ref yönetimi ── */
  const openSwipeKey = useRef<string | null>(null);
  const swipeRowRefs = useRef<Map<string, any>>(new Map());

  /* sekme değiştiğinde açık swipe'ı kapat */
  React.useEffect(() => {
    if (isFocused) return;
    if (openSwipeKey.current) {
      const row = swipeRowRefs.current.get(openSwipeKey.current);
      row?.close?.();
      openSwipeKey.current = null;
    }
  }, [isFocused]);

  const handleManualRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await refresh();
    } finally {
      setManualRefreshing(false);
    }
  }, [refresh]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const listData = [...watchlist].sort((a, b) => {
    const qa = quotes[a];
    const qb = quotes[b];
    let va = 0, vb = 0;
    if (sortKey === "name") {
      const c = a.localeCompare(b);
      return sortDir === "asc" ? c : -c;
    }
    if (sortKey === "price") { va = qa?.regularMarketPrice ?? 0; vb = qb?.regularMarketPrice ?? 0; }
    if (sortKey === "change") { va = qa?.regularMarketChangePercent ?? 0; vb = qb?.regularMarketChangePercent ?? 0; }
    if (sortKey === "volume") { va = qa?.regularMarketVolume ?? 0; vb = qb?.regularMarketVolume ?? 0; }
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

  const upCount = watchlist.filter((s) => (quotes[s]?.regularMarketChangePercent ?? 0) > 0).length;
  const downCount = watchlist.filter((s) => (quotes[s]?.regularMarketChangePercent ?? 0) < 0).length;

  const topPaddingStyle = { paddingTop: insets.top + 10 };

  const handleRemove = useCallback((symbol: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    removeFromWatchlist(symbol);
  }, [removeFromWatchlist]);

  const SECTORS = Array.from(new Set(UNIQUE_BIST_STOCKS.map((s) => s.sector))).sort();

  const availableStocks = UNIQUE_BIST_STOCKS.filter((stock) => {
    if (watchlist.includes(stock.symbol)) return false;
    const q = addQuery.trim().toUpperCase();
    const matchQuery = !q || stock.symbol.includes(q) || stock.name.toUpperCase().includes(q);
    const matchSector = selectedSector == null || stock.sector === selectedSector;
    return matchQuery && matchSector;
  }).slice(0, 30);

  const handleSector = useCallback((sector: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setSelectedSector((prev) => (prev === sector ? null : sector));
  }, []);

  const SortBtn = ({ label, k }: { label: string; k: SortKey }) => (
    <Pressable onPress={() => handleSort(k)} style={styles.sortBtn}>
      <Text style={[styles.sortLabel, { color: sortKey === k ? colors.primary : colors.mutedForeground }]}>
        {label}
      </Text>
      {sortKey === k && (
        sortDir === "desc"
          ? <IconChevronDown color={colors.primary} size={11} />
          : <IconChevronUp color={colors.primary} size={11} />
      )}
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }, topPaddingStyle]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>BIST Hisseleri</Text>
          <View style={styles.headerSub}>
            <View style={[styles.statusDot, { backgroundColor: isMarketOpen ? colors.up : colors.mutedForeground }]} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {isMarketOpen ? "Borsa Açık" : "Borsa Kapalı"}
            </Text>
            {lastUpdated && (
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                {" • "}{formatTime(lastUpdated)}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.headerRight}>
          {Object.keys(quotes).length > 0 && (
            <View style={styles.marketSummary}>
              <View style={styles.summaryChip}>
                <Text style={[styles.summaryNum, { color: colors.up }]}>{upCount}</Text>
                <Text style={[styles.summaryArrow, { color: colors.up }]}>▲</Text>
              </View>
              <View style={styles.summaryChip}>
                <Text style={[styles.summaryNum, { color: colors.down }]}>{downCount}</Text>
                <Text style={[styles.summaryArrow, { color: colors.down }]}>▼</Text>
              </View>
            </View>
          )}
          <Pressable
            onPress={() => { setAddQuery(""); setSelectedSector(null); setShowAddModal(true); }}
            hitSlop={10}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <IconPlus color={colors.primaryForeground} size={15} />
          </Pressable>
          <Pressable onPress={handleManualRefresh} hitSlop={12} style={[styles.refreshBtn, { backgroundColor: colors.secondary }]}>
            <IconRefresh color={colors.mutedForeground} size={14} />
          </Pressable>
        </View>
      </View>

      {/* Sort row */}
      <View style={[styles.sortRow, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <SortBtn label="Sembol" k="name" />
        <View style={styles.spacer} />
        <SortBtn label="Hacim" k="volume" />
        <SortBtn label="Fiyat" k="price" />
        <SortBtn label="Değişim" k="change" />
        <View style={{ width: 28 }} />
      </View>

      {/* Hisse ekleme modalı — sector filtreli */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior="padding" style={styles.modalKeyboard}>
            <View style={[styles.addModal, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 14 }]}>
              <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
              <View style={styles.modalHeader}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.foreground }]}>Listeye hisse ekle</Text>
                  <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>{watchlist.length} hisse listede</Text>
                </View>
                <Pressable onPress={() => setShowAddModal(false)} hitSlop={10} style={[styles.modalCloseBtn, { backgroundColor: colors.secondary }]}>
                  <IconX color={colors.mutedForeground} size={15} />
                </Pressable>
              </View>
              <TextInput
                autoFocus
                value={addQuery}
                onChangeText={setAddQuery}
                placeholder="Sembol veya şirket ara"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.addInput, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }]}
                returnKeyType="search"
              />
              {/* Sector chips */}
              <FlatList
                data={SECTORS}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(s) => s}
                style={styles.sectorRow}
                contentContainerStyle={{ paddingHorizontal: 0, gap: 6, paddingVertical: 6 }}
                renderItem={({ item }) => {
                  const active = selectedSector === item;
                  return (
                    <Pressable
                      style={[styles.sectorChip, { backgroundColor: active ? colors.primary : colors.background, borderColor: active ? colors.primary : colors.border }]}
                      onPress={() => handleSector(item)}
                    >
                      <Text style={[styles.sectorText, { color: active ? "#fff" : colors.mutedForeground }]}>
                        {item}
                      </Text>
                    </Pressable>
                  );
                }}
              />
              {/* Count */}
              <View style={[styles.countBar, { borderBottomColor: colors.border }]}>
                <Text style={[styles.countText, { color: colors.mutedForeground }]}>
                  {availableStocks.length} hisse{selectedSector ? ` · ${selectedSector}` : ""}{addQuery.length > 0 ? ` · "${addQuery}"` : ""}
                </Text>
                {(addQuery.length > 0 || selectedSector) && (
                  <Pressable onPress={() => { setAddQuery(""); setSelectedSector(null); }} hitSlop={8}>
                    <Text style={[styles.clearAllText, { color: colors.primary }]}>Temizle</Text>
                  </Pressable>
                )}
              </View>
              <FlatList
                data={availableStocks}
                keyExtractor={(item) => item.symbol}
                keyboardShouldPersistTaps="handled"
                style={styles.addResults}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => { addToWatchlist(item.symbol); setShowAddModal(false); }}
                    style={({ pressed }) => [styles.addResultRow, { borderBottomColor: colors.border }, pressed && { opacity: 0.65 }]}
                  >
                    <View style={styles.addResultCopy}>
                      <Text style={[styles.addResultSymbol, { color: colors.foreground }]}>{item.symbol}</Text>
                      <Text style={[styles.addResultName, { color: colors.mutedForeground }]} numberOfLines={1}>{item.name}</Text>
                    </View>
                    <IconPlus color={colors.primary} size={18} />
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={[styles.addEmpty, { color: colors.mutedForeground }]}>Eklenecek hisse bulunamadı.</Text>}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {loading && Object.keys(quotes).length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Veriler yükleniyor...</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <MarketRow
              ref={(r) => {
                if (r) swipeRowRefs.current.set(item, r);
                else swipeRowRefs.current.delete(item);
              }}
              symbol={item}
              quote={quotes[item]}
              onRemove={() => handleRemove(item)}
              onSwipeOpen={() => {
                /* önce açık olanı kapat */
                if (openSwipeKey.current && openSwipeKey.current !== item) {
                  const prev = swipeRowRefs.current.get(openSwipeKey.current);
                  prev?.close?.();
                }
                openSwipeKey.current = item;
              }}
              onSwipeClose={() => {
                if (openSwipeKey.current === item) {
                  openSwipeKey.current = null;
                }
              }}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={manualRefreshing}
              onRefresh={handleManualRefresh}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => null}
          maxToRenderPerBatch={15}
          windowSize={5}
          removeClippedSubviews={true}
          initialNumToRender={12}
          updateCellsBatchingPeriod={100}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  headerSub: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  marketSummary: { flexDirection: "row", gap: 8 },
  summaryChip: { flexDirection: "row", alignItems: "center", gap: 2 },
  summaryNum: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryArrow: { fontSize: 9 },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  refreshBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 4 },
  sortLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  spacer: { flex: 1 },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.58)" },
  modalKeyboard: { width: "100%", justifyContent: "flex-end" },
  addModal: { maxHeight: "86%", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10 },
  modalHandle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  modalSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3 },
  modalCloseBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  addInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 8 },
  sectorRow: { maxHeight: 48 },
  sectorChip: { minHeight: 32, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1 },
  sectorText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  countBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  countText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  clearAllText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  addResults: { maxHeight: 320 },
  addResultRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  addResultCopy: { flex: 1, marginRight: 10 },
  addResultSymbol: { fontSize: 14, fontFamily: "Inter_700Bold" },
  addResultName: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  addEmpty: { textAlign: "center", paddingVertical: 24, fontSize: 13, fontFamily: "Inter_400Regular" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  swipeDelete: {
    width: DELETE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  swipeDeleteText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
