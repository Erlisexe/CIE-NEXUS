import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, shadow } from "../theme";

export function ScreenHeader({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return (
    <View style={styles.header}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

export function LoadingState() {
  return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" }) {
  return <View style={[styles.pill, tone === "success" && styles.pillSuccess, tone === "warning" && styles.pillWarning]}><Text style={styles.pillText}>{label}</Text></View>;
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  header: { gap: 5, marginBottom: 18 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  detail: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 17, gap: 9, ...shadow },
  empty: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, gap: 7, padding: 28 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  loading: { alignItems: "center", justifyContent: "center", minHeight: 280 },
  pill: { alignSelf: "flex-start", backgroundColor: colors.surfaceMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillSuccess: { backgroundColor: "#E4F6EF" },
  pillWarning: { backgroundColor: "#FFF1D9" },
  pillText: { color: colors.text, fontSize: 12, fontWeight: "700" },
  button: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 14, minHeight: 48, justifyContent: "center", paddingHorizontal: 18 },
  buttonDisabled: { backgroundColor: "#A9BCD0" },
  buttonPressed: { backgroundColor: colors.primaryStrong },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
