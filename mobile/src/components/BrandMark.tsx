import { Image, StyleSheet, View } from "react-native";
import symbol from "../../assets/brand-symbol.png";
import logo from "../../assets/cie-logo.png";

export function BrandMark({ size = 44, variant = "symbol" }: { size?: number; variant?: "symbol" | "logo" }) {
  if (variant === "logo") {
    return (
      <View accessibilityLabel="CIE" style={[styles.logoWrap, { height: size, width: size * (300 / 129) }]}>
        <Image alt="CIE" resizeMode="contain" source={logo} style={styles.image} />
      </View>
    );
  }

  return (
    <View accessibilityLabel="Símbolo de CIE" style={{ height: size, width: size }}>
      <Image alt="Símbolo de CIE" resizeMode="contain" source={symbol} style={styles.image} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { height: "100%", width: "100%" },
  logoWrap: { justifyContent: "center" },
});
