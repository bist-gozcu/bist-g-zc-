import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useStocks } from "@/contexts/StockContext";
import { useFavorites } from "@/contexts/FavoritesContext";
import StockRow from "@/components/StockRow";
import EmptyState from "@/components/EmptyState";
import { IconTrash } from "@/components/TabIcon";

/* ── silme alanı genişliği (ekranın ~%18'i kadar) ── */
const DELETE_ACTION_WIDTH = 64;

/* ── swipe-to-delete + sürükle satır bileşeni ── */
function SwipeableFavoriteRow({
  symbol,
  quote,
  onRemove,
  drag,
  isActive,
  purpleColor,
  accentColor,
}: {
  symbol: string;
  quote: any;
  onRemove: () => void;
  drag: () => void;
  isActive: boolean;
  purpleColor: string;
  accentColor: string;
}) {
  const swipeRef = useRef<Swipeable>(null);

  const renderRightActions = () => (
    <View
      style={[
        styles.swipeContainer,
        { backgroundColor: purpleColor },
      ]}
    >
      <Pressable
        onPress={() => {
          swipeRef.current?.close();
          onRemove();
        }}
        style={styles.swipeBtn}
        accessibilityRole="button"
        accessibilityLabel={`${symbol} favorilerden çıkar`}
      >
        <IconTrash color="#fff" size={20} />
      </Pressable>
    </View>
  );

  return (
    <ScaleDecorator>
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={1}
      >
        <Pressable
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            drag();
          }}
          delayLongPress={350}
          style={[
            styles.rowWrap,
            isActive && { backgroundColor: accentColor, opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${symbol} sırasını değiştirmek için basılı tut`}
        >
          <View style={styles.rowFlex}>
            <StockRow symbol={symbol} quote={quote} showFavoriteBtn={true} />
          </View>
        </Pressable>
      </Swipeable>
    </ScaleDecorator>
  );
}

/* ── ana ekran ── */
export default function FavoritesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { quotes, refresh } = useStocks();
  const { favorites, removeFavorite, reorder } = useFavorites();
  const [manualRefreshing, setManualRefreshing] = useState(false);

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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      removeFavorite(symbol);
    },
    [removeFavorite],
  );

  const topPaddingStyle = { paddingTop: insets.top + 10 };

  return (
    <GestureHandlerRootView style={styles.root}>
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background },
          topPaddingStyle,
        ]}
      >
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
            activationDistance={10}
            onDragEnd={({ from, to }) => {
              if (from !== to) {
                Haptics.selectionAsync();
                reorder(from, to);
              }
            }}
            renderItem={({ item, drag, isActive }: RenderItemParams<string>) => (
              <SwipeableFavoriteRow
                symbol={item}
                quote={quotes[item]}
                onRemove={() => handleRemove(item)}
                drag={drag}
                isActive={isActive}
                purpleColor={colors.purple}
                accentColor={colors.accent}
              />
            )}
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
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  countBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  rowWrap: { flexDirection: "row", alignItems: "center" },
  rowFlex: { flex: 1 },
  swipeContainer: {
    width: DELETE_ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
  },
  swipeBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
