import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import type { SignaturePoint } from "../../../lib/mobile-collection.ts";
import { colors } from "../theme";

export function SignaturePad({ strokes, onChange, onDrawing, readOnly = false, label = "Firma del profesional" }: {
  strokes: SignaturePoint[][]; onChange?: (value: SignaturePoint[][]) => void; onDrawing?: (value: boolean) => void; readOnly?: boolean; label?: string;
}) {
  const [width, setWidth] = useState(300);
  const current = useRef(strokes);
  useEffect(() => { current.current = strokes; }, [strokes]);
  const tracing = useRef(false);
  const point = (event: GestureResponderEvent): SignaturePoint => ({
    x: Math.max(0, Math.min(1, event.nativeEvent.locationX / width)),
    y: Math.max(0, Math.min(1, event.nativeEvent.locationY / 160)),
  });
  const change = (value: SignaturePoint[][]) => { current.current = value; onChange?.(value); };
  function finish() { tracing.current = false; onDrawing?.(false); }
  return <View style={styles.container}>
    <View accessibilityLabel={readOnly ? `${label} registrada` : `Área para trazar: ${label}`}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.pad}
      onStartShouldSetResponder={() => !readOnly} onMoveShouldSetResponder={() => !readOnly}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        if (readOnly || current.current.length >= 80 || current.current.flat().length >= 1200) return;
        tracing.current = true; onDrawing?.(true); change([...current.current, [point(e)]]);
      }}
      onResponderMove={(e) => {
        if (!tracing.current || current.current.flat().length >= 1200) return;
        const next = point(e), stroke = current.current.at(-1)!, last = stroke.at(-1)!;
        if (Math.hypot((next.x-last.x)*width, (next.y-last.y)*160) < 2) return;
        change([...current.current.slice(0,-1), [...stroke,next]]);
      }} onResponderRelease={finish} onResponderTerminate={finish}>
      {!strokes.length ? <Text pointerEvents="none" style={styles.placeholder}>Firma aquí</Text> : null}
      {strokes.flatMap((stroke, i) => stroke.slice(1).map((p,j) => {
        const a=stroke[j]!, dx=(p.x-a.x)*width, dy=(p.y-a.y)*160, length=Math.hypot(dx,dy);
        return <View pointerEvents="none" key={`${i}:${j}`} style={[styles.line,{width:length,left:(p.x+a.x)*width/2-length/2,top:(p.y+a.y)*80-1,transform:[{rotate:`${Math.atan2(dy,dx)}rad`}]}]}/>;
      }))}
    </View>
    {!readOnly ? <Pressable accessibilityRole="button" onPress={() => { finish(); change([]); }} style={styles.clear}><Text style={styles.clearText}>Limpiar firma</Text></Pressable> : null}
  </View>;
}
const styles=StyleSheet.create({
  container:{gap:8},pad:{height:160,backgroundColor:colors.surface,borderColor:colors.borderStrong,borderWidth:1,borderRadius:12,overflow:"hidden"},
  line:{position:"absolute",height:2,backgroundColor:colors.textStrong,borderRadius:1},placeholder:{padding:18,fontSize:16,color:colors.textMuted},
  clear:{minHeight:48,justifyContent:"center",alignSelf:"flex-start",paddingHorizontal:12},clearText:{fontSize:15,color:colors.primaryStrong,fontWeight:"700"},
});
