import { StyleSheet, View } from "react-native";

export type NavIconName = "home" | "children" | "calendar" | "profile";

export function NavIcon({ name, color, size = 24 }: { name: NavIconName; color: string; size?: number }) {
  const scale = size / 24;
  if (name === "home") {
    return (
      <View style={{ height: size, width: size }}>
        <View style={[styles.homeRoof, { borderColor: color, transform: [{ rotate: "45deg" }, { scale }] }]} />
        <View style={[styles.homeBody, { borderColor: color, transform: [{ scale }] }]} />
        <View style={[styles.homeDoor, { backgroundColor: color, transform: [{ scale }] }]} />
      </View>
    );
  }
  if (name === "children") {
    return (
      <View style={{ height: size, width: size }}>
        <View style={[styles.personHeadMain, { borderColor: color, transform: [{ scale }] }]} />
        <View style={[styles.personHeadSide, { borderColor: color, transform: [{ scale }] }]} />
        <View style={[styles.personBodyMain, { borderColor: color, transform: [{ scale }] }]} />
        <View style={[styles.personBodySide, { borderColor: color, transform: [{ scale }] }]} />
      </View>
    );
  }
  if (name === "calendar") {
    return (
      <View style={[styles.calendar, { borderColor: color, height: size * 0.83, width: size * 0.88 }]}>
        <View style={[styles.calendarHeader, { backgroundColor: color }]} />
        <View style={[styles.calendarRingLeft, { backgroundColor: color }]} />
        <View style={[styles.calendarRingRight, { backgroundColor: color }]} />
        <View style={styles.calendarDots}>
          {[0, 1, 2, 3, 4, 5].map((dot) => <View key={dot} style={[styles.calendarDot, { backgroundColor: color }]} />)}
        </View>
      </View>
    );
  }
  return (
    <View style={{ height: size, width: size }}>
      <View style={[styles.profileHead, { borderColor: color, transform: [{ scale }] }]} />
      <View style={[styles.profileBody, { borderColor: color, transform: [{ scale }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  homeRoof: { borderLeftWidth: 2, borderTopWidth: 2, height: 12, left: 6, position: "absolute", top: 3, width: 12 },
  homeBody: { borderBottomLeftRadius: 3, borderBottomRightRadius: 3, borderBottomWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, height: 11, left: 5, position: "absolute", top: 10, width: 14 },
  homeDoor: { borderRadius: 1, bottom: 3, height: 7, left: 10, position: "absolute", width: 4 },
  personHeadMain: { borderRadius: 99, borderWidth: 2, height: 7, left: 4, position: "absolute", top: 4, width: 7 },
  personHeadSide: { borderRadius: 99, borderWidth: 2, height: 6, position: "absolute", right: 3, top: 6, width: 6 },
  personBodyMain: { borderTopLeftRadius: 9, borderTopRightRadius: 9, borderWidth: 2, bottom: 2, height: 9, left: 1, position: "absolute", width: 14 },
  personBodySide: { borderTopLeftRadius: 8, borderTopRightRadius: 8, borderWidth: 2, bottom: 2, height: 8, position: "absolute", right: 0, width: 11 },
  calendar: { alignSelf: "center", borderRadius: 4, borderWidth: 2, marginTop: 2, overflow: "visible" },
  calendarHeader: { height: 2, left: 0, position: "absolute", right: 0, top: 5 },
  calendarRingLeft: { borderRadius: 2, height: 5, left: 4, position: "absolute", top: -3, width: 2 },
  calendarRingRight: { borderRadius: 2, height: 5, position: "absolute", right: 4, top: -3, width: 2 },
  calendarDots: { flexDirection: "row", flexWrap: "wrap", gap: 3, left: 4, position: "absolute", right: 3, top: 10 },
  calendarDot: { borderRadius: 1, height: 2, width: 2 },
  profileHead: { borderRadius: 99, borderWidth: 2, height: 8, left: 8, position: "absolute", top: 3, width: 8 },
  profileBody: { borderTopLeftRadius: 10, borderTopRightRadius: 10, borderWidth: 2, bottom: 2, height: 10, left: 4, position: "absolute", width: 16 },
});
