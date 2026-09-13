import React, { useCallback, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useStocks } from "@/contexts/StockContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import StockRow from "@/components/StockRow";
import EmptyState from "@/components/EmptyState";
import {
  IconTrash,
  IconArrowUp,
  IconArrowDown,
  IconGrip,
} from "@/components/TabIcon";
import { useIsFocused } from "@react-navigation/native";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";

/* ── swipe silme alanı genişliği ── */
const DELETE_ACTION_WIDTH = 76;

/* ── swipe-to-delete + sıralama satır bileşeni ── */
const FavoriteRow = React.forwardRef(function FavoriteRow(
  {
    symbol,
    quote,
    onRemove,
    editMode,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
    onSwipeOpen,
    onSwipeClose,
    drag,
    isActive,
  }: {
    symbol: string;
    quote: any;
    onRemove: () => void;
    editMode: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onSwipeOpen: () => void;
    onSwipeClose: () => void;
    drag?: () => void;
    isActive?: boolean;
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
    <ScaleDecorator>
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={2}
        enabled={!editMode}
        onSwipeableWillOpen={onSwipeOpen}
        onSwipeableWillClose={onSwipeClose}
      >
        <View
          style={[
            styles.rowWrap,
            {
              backgroundColor: isActive ? `${colors.primary}12` : colors.card,
              borderBottomColor: colors.border,
            },
          ]}
        >
          {editMode ? (
            <View style={styles.reorderSection}>
              <Pressable
                onLongPress={drag}
                delayLongPress={150}
                hitSlop={6}
                style={styles.gripBtn}
              >
                <IconGrip color={colors.mutedForeground} size={16} />
              </Pressable>
              <View style={styles.reorderBtns}>
                <Pressable onPress={onMoveUp} disabled={!canMoveUp} hitSlop={6} style={styles.reorderBtn}>
                  <IconArrowUp color={canMoveUp ? colors.mutedForeground : colors.border} size={16} />
                </Pressable>
                <Pressable onPress={onMoveDown} disabled={!canMoveDown} hitSlop={6} style={styles.reorderBtn}>
                  <IconArrowDown color={canMoveDown ? colors.mutedForeground : colors.border} size={16} />
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.rowFlex}>
            <StockRow symbol={symbol} quote={quote} showFavoriteBtn={true} />
          </View>
        </View>
      </Swipeable>
    </ScaleDecorator>
  );
});

/* ── ana ekran ── */
export default function FavoritesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { quotes, refresh } = useStocks();
  const { favorites, removeFavorite, reorder } = useFavorites();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [editMode, setEditMode] = useState(false);

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

  /* edit moddan çıkarken açık swipe varsa kapat */
  React.useEffect(() => {
    if (!editMode && openSwipeKey.current) {
      const row = swipeRowRefs.current.get(openSwipeKey.current);
      row?.close?.();
      openSwipeKey.current = null;
    }
  }, [editMode]);

  const handleManualRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await refresh();
    } finally {
      setManualRefreshing(false);
    }
  }, [refresh]);

  const handleRemove = useCallback(
    (symbol: string) => {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      removeFavorite(symbol);
    },
    [removeFavorite],
  );

  const handleMove = useCallback(
    (index: number, direction: -1 | 1) => {
      const to = index + direction;
      if (to < 0 || to >= favorites.length) return;
      if (Platform.OS !== "web") Haptics.selectionAsync();
      reorder(index, to);
    },
    [favorites.length, reorder],
  );

  const handleDragEnd = useCallback(
    ({ from, to }: { from: number; to: number }) => {
      if (from === to) return;
      if (Platform.OS !== "web") Haptics.selectionAsync();
      reorder(from, to);
    },
    [reorder],
  );

  const topPaddingStyle = { paddingTop: insets.top + 10 };

  const renderItem = useCallback(
    ({ item, getIndex, drag, isActive }: RenderItemParams<string>) => {
      const index = getIndex() ?? 0;
      return (
      <FavoriteRow
        ref={(r) => {
          if (r) swipeRowRefs.current.set(item, r);
          else swipeRowRefs.current.delete(item);
        }}
        symbol={item}
        quote={quotes[item]}
        onRemove={() => handleRemove(item)}
        editMode={editMode}
        onMoveUp={() => handleMove(index, -1)}
        onMoveDown={() => handleMove(index, 1)}
        canMoveUp={index > 0}
        canMoveDown={index < favorites.length - 1}
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
        drag={drag}
        isActive={isActive}
      />
    );
    },
    [editMode, favorites.length, quotes, handleRemove, handleMove],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[topPaddingStyle, { flex: 1 }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Favoriler
            </Text>
            {favorites.length > 0 && (
              <View
                style={[
                  styles.countBadge,
                  { backgroundColor: colors.secondary },
                ]}
              >
                <Text
                  style={[styles.countText, { color: colors.mutedForeground }]}
                >
                  {favorites.length}
                </Text>
              </View>
            )}
          </View>
          {favorites.length > 0 && (
            <Pressable
              onPress={() => setEditMode((v) => !v)}
              hitSlop={10}
              style={[
                styles.editBtn,
                { backgroundColor: editMode ? `${colors.primary}20` : colors.secondary },
              ]}
            >
              <Text
                style={[
                  styles.editBtnText,
                  { color: editMode ? colors.primary : colors.mutedForeground },
                ]}
              >
                {editMode ? "Tamam" : "Sırala"}
              </Text>
            </Pressable>
          )}
        </View>

        {favorites.length === 0 ? (
          <EmptyState
            icon="star"
            title="Favori hisse yok"
            subtitle="Piyasa veya Arama ekranından yıldıza basarak hisse ekleyin"
          />
        ) : (
          <DraggableFlatList
            data={favorites}
            keyExtractor={(item) => item}
            renderItem={renderItem}
            onDragEnd={handleDragEnd}
            activationDistance={editMode ? 5 : 999}
            refreshControl={
              <RefreshControl
                refreshing={manualRefreshing}
                onRefresh={handleManualRefresh}
                tintColor={colors.primary}
              />
            }
            contentContainerStyle={{ paddingBottom: insets.bottom + 150 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  countBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  editBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  editBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rowWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowFlex: { flex: 1 },
  reorderSection: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    gap: 2,
  },
  gripBtn: { padding: 4 },
  reorderBtns: { flexDirection: "column", gap: 6 },
  reorderBtn: { padding: 2 },
  swipeDelete: {
    width: DELETE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  swipeDeleteText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
