import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { BrandMark } from "./components/BrandMark";
import { NavIcon, type NavIconName } from "./components/NavIcon";
import { mobileGet, MobileApiError } from "./lib/api";
import { useCollection } from "./collection/useCollection";
import { CollectionWorkspace } from "./collection/CollectionWorkspace";
import { supabase } from "./lib/supabase";
import { colors, shadow, softShadow } from "./theme";
import type { Appointment, Bootstrap, ChildDetail, ChildSummary, Program, Target } from "./types";
import { targetStateLabel } from "../../lib/clinical-mastery.ts";

type Tab = "today" | "children" | "calendar" | "profile";
type ChildSection = "summary" | "programs" | "progress" | "plan";
type Tone = "neutral" | "brand" | "success" | "warning" | "coral";

const TAB_ITEMS: Array<{ key: Tab; label: string; icon: NavIconName }> = [
  { key: "today", label: "Hoy", icon: "home" },
  { key: "children", label: "Niños", icon: "children" },
  { key: "calendar", label: "Agenda", icon: "calendar" },
  { key: "profile", label: "Perfil", icon: "profile" },
];

const CHILD_SECTIONS: Array<{ key: ChildSection; label: string }> = [
  { key: "summary", label: "Resumen" },
  { key: "programs", label: "Programas" },
  { key: "progress", label: "Progreso" },
  { key: "plan", label: "Plan" },
];

function ImmersiveSystemChrome() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const hideSystemChrome = () => {
      StatusBar.setHidden(true, "fade");
      NavigationBar.setHidden(true);
    };
    hideSystemChrome();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") hideSystemChrome();
    });
    return () => subscription.remove();
  }, []);

  return (
    <>
      <StatusBar animated hidden />
      {Platform.OS === "android" ? <NavigationBar hidden /> : null}
    </>
  );
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate() {
  return toDateKey(new Date());
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, amount: number) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

function dateRange(start: string, length: number) {
  return Array.from({ length }, (_, index) => addDays(start, index));
}

function readableDate(value: string, long = false) {
  const date = dateFromKey(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    "es-NI",
    long
      ? { weekday: "long", day: "numeric", month: "long" }
      : { day: "numeric", month: "short" },
  ).format(date);
}

function weekday(value: string) {
  const result = new Intl.DateTimeFormat("es-NI", { weekday: "short" }).format(dateFromKey(value));
  return result.replace(".", "").slice(0, 3);
}

function tidyTime(value: string) {
  return value.slice(0, 5);
}

function stateLabel(value: string) {
  return ["baseline", "acquisition", "generalization", "maintenance", "closed"].includes(value)
    ? targetStateLabel(value as "baseline" | "acquisition" | "generalization" | "maintenance" | "closed")
    : value;
}

function stateTone(value: string): Tone {
  if (value === "baseline") return "warning";
  if (value === "generalization") return "coral";
  if (value === "maintenance" || value === "closed") return "success";
  return "brand";
}

function statusLabel(value: string) {
  return ({
    scheduled: "Programada",
    in_progress: "En curso",
    completed: "Completada",
    cancelled: "Cancelada",
  } as Record<string, string>)[value] || value;
}

function statusTone(value: string): Tone {
  if (value === "completed") return "success";
  if (value === "cancelled") return "coral";
  if (value === "in_progress") return "warning";
  return "brand";
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "C";
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
}

function PageColumn({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return <View style={[styles.pageColumn, width >= 820 && styles.pageColumnWide]}>{children}</View>;
}

function Surface({ children, accent = "none" }: { children: ReactNode; accent?: "none" | "blue" | "yellow" | "coral" }) {
  return (
    <View
      style={[
        styles.surface,
        accent === "blue" && styles.surfaceBlue,
        accent === "yellow" && styles.surfaceYellow,
        accent === "coral" && styles.surfaceCoral,
      ]}
    >
      {children}
    </View>
  );
}

function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <View
      style={[
        styles.pill,
        tone === "brand" && styles.pillBrand,
        tone === "success" && styles.pillSuccess,
        tone === "warning" && styles.pillWarning,
        tone === "coral" && styles.pillCoral,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          tone === "brand" && styles.pillTextBrand,
          tone === "success" && styles.pillTextSuccess,
          tone === "warning" && styles.pillTextWarning,
          tone === "coral" && styles.pillTextCoral,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet" | "coral";
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === "secondary" && styles.actionButtonSecondary,
        variant === "quiet" && styles.actionButtonQuiet,
        variant === "coral" && styles.actionButtonCoral,
        disabled && styles.actionButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.actionButtonText,
          (variant === "secondary" || variant === "quiet") && styles.actionButtonTextSecondary,
        ]}
      >
        {label}
      </Text>
      {variant !== "quiet" ? <Text style={[styles.buttonArrow, variant === "secondary" && styles.buttonArrowSecondary]}>›</Text> : null}
    </Pressable>
  );
}

function Avatar({ child, size = 56 }: { child: Pick<ChildSummary, "fullName" | "photoUrl">; size?: number }) {
  if (child.photoUrl) {
    return <Image alt={child.fullName} source={{ uri: child.photoUrl }} style={[styles.avatarImage, { borderRadius: size / 2, height: size, width: size }]} />;
  }
  return (
    <View style={[styles.avatarFallback, { borderRadius: size / 2, height: size, width: size }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.31 }]}>{initials(child.fullName)}</Text>
    </View>
  );
}

function ScreenIntro({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail?: string }) {
  return (
    <View style={styles.screenIntro}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.screenTitle}>{title}</Text>
      {detail ? <Text style={styles.screenDetail}>{detail}</Text> : null}
    </View>
  );
}

function SectionHeading({ title, trailing }: { title: string; trailing?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {trailing ? <Text style={styles.sectionTrailing}>{trailing}</Text> : null}
    </View>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyMark}><BrandMark size={44} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

function LoadingState({ label = "Cargando información clínica…" }: { label?: string }) {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

function TopBar({ bootstrap, connected }: { bootstrap: Bootstrap; connected: boolean }) {
  return (
    <View style={styles.topBar}>
      <PageColumn>
        <View style={styles.topBarRow}>
          <View style={styles.topBrand}>
            <BrandMark size={27} variant="logo" />
            <View style={styles.brandDivider} />
            <Text style={styles.nexusLabel}>Nexus</Text>
          </View>
          <View style={styles.topActions}>
            <View style={styles.connectionPill}>
              <View style={[styles.connectionDot, !connected && styles.connectionDotOffline]} />
              <Text style={styles.connectionText}>{connected ? "En línea" : "Sin conexión"}</Text>
            </View>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>{initials(bootstrap.account.displayName)}</Text>
            </View>
          </View>
        </View>
      </PageColumn>
    </View>
  );
}

function DateRail({
  dates,
  selected,
  appointments,
  onSelect,
}: {
  dates: string[];
  selected: string;
  appointments: Appointment[];
  onSelect: (date: string) => void;
}) {
  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    appointments.forEach((appointment) => {
      if (appointment.status !== "cancelled") next[appointment.sessionDate] = (next[appointment.sessionDate] || 0) + 1;
    });
    return next;
  }, [appointments]);
  const today = localDate();

  return (
    <ScrollView contentContainerStyle={styles.dateRail} horizontal showsHorizontalScrollIndicator={false}>
      {dates.map((date) => {
        const active = date === selected;
        const count = counts[date] || 0;
        return (
          <Pressable
            key={date}
            accessibilityLabel={`${readableDate(date, true)}${count ? `, ${count} sesiones` : ""}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(date)}
            style={({ pressed }) => [styles.dateItem, active && styles.dateItemActive, pressed && styles.pressed]}
          >
            <Text style={[styles.dateWeekday, active && styles.dateWeekdayActive]}>{weekday(date)}</Text>
            <Text style={[styles.dateNumber, active && styles.dateNumberActive]}>{dateFromKey(date).getDate()}</Text>
            <View style={[styles.dateIndicator, count > 0 && styles.dateIndicatorBusy, date === today && !active && styles.dateIndicatorToday]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function MiniStat({ value, label, tone = "blue" }: { value: string | number; label: string; tone?: "blue" | "yellow" | "coral" }) {
  return (
    <View style={[styles.miniStat, tone === "yellow" && styles.miniStatYellow, tone === "coral" && styles.miniStatCoral]}>
      <Text style={[styles.miniStatValue, tone === "yellow" && styles.miniStatValueYellow, tone === "coral" && styles.miniStatValueCoral]}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function NextSessionCard({
  appointment,
  child,
  onOpen,
}: {
  appointment: Appointment;
  child: ChildSummary | undefined;
  onOpen: () => void;
}) {
  const isToday = appointment.sessionDate === localDate();
  return (
    <View style={styles.nextCard}>
      <View style={styles.nextAccentYellow} />
      <View style={styles.nextAccentCoral} />
      <View style={styles.nextCardTop}>
        <View>
          <Text style={styles.nextEyebrow}>Siguiente sesión</Text>
          <Text style={styles.nextTime}>{tidyTime(appointment.startTime)}–{tidyTime(appointment.endTime)}</Text>
        </View>
        <Pill label={isToday ? "Hoy" : readableDate(appointment.sessionDate)} tone="warning" />
      </View>
      <View style={styles.nextChildRow}>
        {child ? <Avatar child={child} size={54} /> : (
          <View style={[styles.avatarFallback, { borderRadius: 27, height: 54, width: 54 }]}>
            <Text style={styles.avatarText}>{initials(appointment.profileName)}</Text>
          </View>
        )}
        <View style={styles.grow}>
          <Text style={styles.nextChildName}>{appointment.profileName}</Text>
          <Text style={styles.nextMeta}>{appointment.sessionType}</Text>
          <Text style={styles.nextMeta}>{appointment.site}</Text>
        </View>
      </View>
      <ActionButton label={child ? "Ver preparación" : "Ver información"} onPress={onOpen} variant="secondary" />
    </View>
  );
}

function ScheduleCard({
  appointment,
  child,
  showDate = false,
  onOpen,
}: {
  appointment: Appointment;
  child?: ChildSummary;
  showDate?: boolean;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <View style={styles.scheduleTimeColumn}>
        <Text style={styles.scheduleTime}>{tidyTime(appointment.startTime)}</Text>
        <Text style={styles.scheduleEnd}>{tidyTime(appointment.endTime)}</Text>
        <View style={styles.timelineDot} />
        <View style={styles.timelineLine} />
      </View>
      <View style={styles.scheduleCardBody}>
        <View style={styles.rowBetween}>
          <View style={styles.grow}>
            {showDate ? <Text style={styles.scheduleDate}>{readableDate(appointment.sessionDate, true)}</Text> : null}
            <Text style={styles.cardTitle}>{appointment.profileName}</Text>
          </View>
          <Pill label={statusLabel(appointment.status)} tone={statusTone(appointment.status)} />
        </View>
        <Text style={styles.cardMeta}>{appointment.sessionType} · {appointment.site}</Text>
        {appointment.notes ? <Text numberOfLines={2} style={styles.appointmentNote}>{appointment.notes}</Text> : null}
        {child ? (
          <View style={styles.inlineAction}>
            <Text style={styles.inlineActionText}>Abrir expediente</Text>
            <Text style={styles.inlineArrow}>›</Text>
          </View>
        ) : null}
      </View>
    </>
  );

  if (onOpen) {
    return (
      <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.scheduleRow, pressed && styles.pressed]}>
        {body}
      </Pressable>
    );
  }
  return <View style={styles.scheduleRow}>{body}</View>;
}

function TodayScreen({
  appointments,
  bootstrap,
  profiles,
  refreshing,
  onRefresh,
  onOpenChild,
}: {
  appointments: Appointment[];
  bootstrap: Bootstrap;
  profiles: ChildSummary[];
  refreshing: boolean;
  onRefresh: () => void;
  onOpenChild: (child: ChildSummary) => void;
}) {
  const today = localDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const dates = useMemo(() => dateRange(today, 8), [today]);
  const activeAppointments = useMemo(
    () => appointments
      .filter((appointment) => appointment.status !== "cancelled")
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.startTime.localeCompare(b.startTime)),
    [appointments],
  );
  const selectedAppointments = activeAppointments.filter((appointment) => appointment.sessionDate === selectedDate);
  const nextAppointment = activeAppointments.find((appointment) => appointment.sessionDate >= today && appointment.status !== "completed");
  const nextChild = nextAppointment ? profiles.find((child) => child.id === nextAppointment.profileId) : undefined;

  const openAppointmentChild = (appointment: Appointment) => {
    const child = profiles.find((candidate) => candidate.id === appointment.profileId);
    if (child) onOpenChild(child);
    else Alert.alert("Expediente no disponible", "Esta cita todavía no tiene un expediente móvil disponible para tu cuenta.");
  };

  return (
    <ScrollView
      contentContainerStyle={styles.screenScroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <PageColumn>
        <ScreenIntro
          eyebrow={readableDate(today, true)}
          title={`Buenos días, ${firstName(bootstrap.account.displayName)}`}
          detail="Tu agenda y tus expedientes asignados, listos para el trabajo clínico."
        />
        <DateRail appointments={activeAppointments} dates={dates} onSelect={setSelectedDate} selected={selectedDate} />
        {nextAppointment ? (
          <NextSessionCard
            appointment={nextAppointment}
            child={nextChild}
            onOpen={() => openAppointmentChild(nextAppointment)}
          />
        ) : (
          <EmptyState title="No tienes sesiones próximas" detail="Las nuevas citas aparecerán aquí cuando sean asignadas a tu cuenta." />
        )}
        <View style={styles.statsRow}>
          <MiniStat label="Sesiones hoy" value={activeAppointments.filter((appointment) => appointment.sessionDate === today).length} />
          <MiniStat label="Niños asignados" tone="yellow" value={bootstrap.scope.activeProfileCount} />
          <MiniStat label="Próximas" tone="coral" value={bootstrap.scope.upcomingAppointmentCount} />
        </View>
        <SectionHeading
          title={selectedDate === today ? "Agenda de hoy" : readableDate(selectedDate, true)}
          trailing={`${selectedAppointments.length} ${selectedAppointments.length === 1 ? "sesión" : "sesiones"}`}
        />
        {selectedAppointments.length ? selectedAppointments.map((appointment) => {
          const child = profiles.find((candidate) => candidate.id === appointment.profileId);
          return (
            <ScheduleCard
              appointment={appointment}
              child={child}
              key={appointment.id}
              onOpen={child ? () => onOpenChild(child) : undefined}
            />
          );
        }) : (
          <EmptyState title="Sin sesiones en esta fecha" detail="Selecciona otro día de la franja para revisar tu agenda." />
        )}
      </PageColumn>
    </ScrollView>
  );
}

function ChildrenScreen({
  profiles,
  refreshing,
  onRefresh,
  onSelect,
}: {
  profiles: ChildSummary[];
  refreshing: boolean;
  onRefresh: () => void;
  onSelect: (child: ChildSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return profiles;
    return profiles.filter((child) => `${child.fullName} ${child.site} ${child.internalCode}`.toLocaleLowerCase("es").includes(normalized));
  }, [profiles, query]);

  return (
    <ScrollView
      contentContainerStyle={styles.screenScroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <PageColumn>
        <ScreenIntro title="Niños asignados" detail="Accede a la información clínica relacionada con tus asignaciones y sesiones." />
        <View style={styles.searchBox}>
          <View style={styles.searchGlyph}><View style={styles.searchCircle} /><View style={styles.searchHandle} /></View>
          <TextInput
            accessibilityLabel="Buscar niño"
            autoCapitalize="words"
            onChangeText={setQuery}
            placeholder="Buscar por nombre, código o sede"
            placeholderTextColor={colors.textSoft}
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable accessibilityLabel="Limpiar búsqueda" accessibilityRole="button" onPress={() => setQuery("")} style={styles.clearSearch}>
              <Text style={styles.clearSearchText}>×</Text>
            </Pressable>
          ) : null}
        </View>
        <SectionHeading title="Expedientes" trailing={`${filtered.length} disponibles`} />
        {filtered.length ? filtered.map((child) => (
          <Pressable
            accessibilityRole="button"
            key={child.id}
            onPress={() => onSelect(child)}
            style={({ pressed }) => [styles.childCard, pressed && styles.pressed]}
          >
            <Avatar child={child} size={58} />
            <View style={styles.grow}>
              <Text style={styles.childName}>{child.fullName}</Text>
              <Text style={styles.cardMeta}>{[child.age !== null ? `${child.age} años` : "", child.site].filter(Boolean).join(" · ")}</Text>
              <View style={styles.childFooter}>
                <Pill label={`${child.activeProgramCount} programa${child.activeProgramCount === 1 ? "" : "s"} activo${child.activeProgramCount === 1 ? "" : "s"}`} tone="brand" />
                {child.internalCode ? <Text style={styles.childCode}>{child.internalCode}</Text> : null}
              </View>
            </View>
            <Text style={styles.cardChevron}>›</Text>
          </Pressable>
        )) : (
          <EmptyState
            title={query ? "No encontramos coincidencias" : "No tienes niños asignados"}
            detail={query ? "Prueba con otro nombre, código o sede." : "Sólo aparecerán expedientes relacionados con tu trabajo clínico."}
          />
        )}
      </PageColumn>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View accessibilityLabel={`${Math.round(percentage)} por ciento`} accessibilityRole="progressbar" style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percentage}%` }]} />
    </View>
  );
}

function TargetRow({ target }: { target: Target }) {
  return (
    <View style={styles.targetRow}>
      <View style={[styles.targetStatusMark, target.masteryAchieved && styles.targetStatusMarkDone]}>
        <Text style={[styles.targetStatusText, target.masteryAchieved && styles.targetStatusTextDone]}>{target.masteryAchieved ? "✓" : target.code.slice(0, 2)}</Text>
      </View>
      <View style={styles.grow}>
        <Text style={styles.targetName}>{target.name}</Text>
        {target.specificObjective ? <Text style={styles.targetObjective}>{target.specificObjective}</Text> : null}
        <Text style={styles.measurementText}>{target.measurement}{target.unitLabel ? ` · ${target.unitLabel}` : ""}</Text>
      </View>
      <Pill label={stateLabel(target.state)} tone={stateTone(target.state)} />
    </View>
  );
}

function ProgramPanel({ program, initiallyExpanded = false }: { program: Program; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const mastered = program.targets.filter((target) => target.masteryAchieved).length;
  return (
    <Surface>
      <View style={styles.rowBetween}>
        <View style={styles.grow}>
          <Text style={styles.programTitle}>{program.name}</Text>
          <Text style={styles.programMeta}>{program.targets.length} targets · {mastered} adquiridos</Text>
        </View>
        <Pill label={`${mastered}/${program.targets.length}`} tone={mastered === program.targets.length && program.targets.length > 0 ? "success" : "brand"} />
      </View>
      <ProgressBar max={program.targets.length} value={mastered} />
      {program.objective ? <Text style={styles.programObjective}>{program.objective}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)} style={styles.expandButton}>
        <Text style={styles.expandButtonText}>{expanded ? "Ocultar targets" : "Ver targets"}</Text>
        <Text style={styles.expandArrow}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>
      {expanded ? <View style={styles.targetList}>{program.targets.map((target) => <TargetRow key={target.id} target={target} />)}</View> : null}
    </Surface>
  );
}

function CumulativeCard({ program }: { program: Program }) {
  const points = program.cumulativeMastery.slice(-8);
  const current = points[points.length - 1]?.total || program.targets.filter((target) => target.masteryAchieved).length;
  const max = Math.max(program.targets.length, current, 1);
  return (
    <Surface>
      <View style={styles.rowBetween}>
        <View style={styles.grow}>
          <Text style={styles.programTitle}>{program.name}</Text>
          <Text style={styles.programMeta}>Adquisición acumulativa</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeValue}>{current}</Text>
          <Text style={styles.totalBadgeLabel}>adquiridos</Text>
        </View>
      </View>
      {points.length ? (
        <>
          <View style={styles.chart}>
            <View style={styles.chartGridLineTop} />
            <View style={styles.chartGridLineMiddle} />
            <View style={styles.chartGridLineBottom} />
            <View style={styles.chartBars}>
              {points.map((point, index) => {
                const height = Math.max(8, Math.round((point.total / max) * 100));
                const latest = index === points.length - 1;
                return (
                  <View key={point.id} style={styles.chartBarSlot}>
                    <Text style={[styles.chartValue, latest && styles.chartValueLatest]}>{point.total}</Text>
                    <View style={[styles.chartBar, { height: `${height}%` }, latest && styles.chartBarLatest]} />
                  </View>
                );
              })}
            </View>
          </View>
          <View style={styles.chartDates}>
            <Text style={styles.chartDate}>{readableDate(points[0]?.date || "")}</Text>
            <Text style={styles.chartDate}>{readableDate(points[points.length - 1]?.date || "")}</Text>
          </View>
        </>
      ) : (
        <View style={styles.chartEmpty}>
          <Text style={styles.chartEmptyTitle}>Aún no hay incrementos acumulativos</Text>
          <Text style={styles.chartEmptyDetail}>La gráfica se actualizará cuando un target alcance su criterio de dominio.</Text>
        </View>
      )}
      <View style={styles.progressSummary}>
        <Text style={styles.progressSummaryLabel}>Progreso del repertorio</Text>
        <Text style={styles.progressSummaryValue}>{current}/{program.targets.length}</Text>
      </View>
      <ProgressBar max={program.targets.length} value={current} />
    </Surface>
  );
}

function ChildSummarySection({ detail }: { detail: ChildDetail }) {
  const totalTargets = detail.programs.reduce((sum, program) => sum + program.targets.length, 0);
  const mastered = detail.programs.reduce((sum, program) => sum + program.targets.filter((target) => target.masteryAchieved).length, 0);
  return (
    <View style={styles.sectionStack}>
      <View style={styles.statsRow}>
        <MiniStat label="Programas" value={detail.programs.length} />
        <MiniStat label="Targets" tone="yellow" value={totalTargets} />
        <MiniStat label="Adquiridos" tone="coral" value={mastered} />
      </View>
      <Surface>
        <SectionHeading title="Datos generales" />
        <InfoRow label="Diagnóstico" value={detail.profile.diagnosis} />
        <InfoRow label="Fecha de nacimiento" value={detail.profile.dateOfBirth} />
        <InfoRow label="Dirección" value={detail.profile.address} />
        <InfoRow label="Teléfono" value={detail.profile.phone} />
        <InfoRow label="Responsable" value={detail.profile.guardianName} />
        <InfoRow label="Teléfono del responsable" value={detail.profile.guardianPhone} />
        <InfoRow label="Idioma preferido" value={detail.profile.preferredLanguage} />
        <InfoRow label="Contacto de emergencia" value={detail.profile.emergencyContact} />
      </Surface>
      <Surface accent="blue">
        <SectionHeading title="Plan activo" trailing={`${detail.programs.length} programas`} />
        {detail.programs.length ? detail.programs.map((program) => (
          <View key={program.id} style={styles.planPreview}>
            <View style={styles.planNumber}><Text style={styles.planNumberText}>{program.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.grow}>
              <Text style={styles.planPreviewTitle}>{program.name}</Text>
              <Text numberOfLines={2} style={styles.planPreviewDetail}>{program.objective || "Sin objetivo registrado."}</Text>
            </View>
          </View>
        )) : <Text style={styles.cardMeta}>No hay programas activos en este perfil.</Text>}
      </Surface>
      {detail.profile.notes ? (
        <Surface accent="yellow">
          <Text style={styles.smallOverline}>INFORMACIÓN RELEVANTE</Text>
          <Text style={styles.bodyText}>{detail.profile.notes}</Text>
        </Surface>
      ) : null}
    </View>
  );
}

function ChildProgramsSection({ programs }: { programs: Program[] }) {
  if (!programs.length) return <EmptyState title="Sin programas activos" detail="Este expediente todavía no tiene programas disponibles para la aplicación móvil." />;
  return <View style={styles.sectionStack}>{programs.map((program, index) => <ProgramPanel initiallyExpanded={index === 0} key={program.id} program={program} />)}</View>;
}

function ChildProgressSection({ programs }: { programs: Program[] }) {
  if (!programs.length) return <EmptyState title="Sin datos de progreso" detail="Las gráficas aparecerán cuando existan programas activos con resultados." />;
  const totalTargets = programs.reduce((sum, program) => sum + program.targets.length, 0);
  const acquired = programs.reduce((sum, program) => sum + program.targets.filter((target) => target.masteryAchieved).length, 0);
  return (
    <View style={styles.sectionStack}>
      <Surface accent="blue">
        <Text style={styles.smallOverline}>PROGRESO GLOBAL</Text>
        <View style={styles.globalProgressRow}>
          <Text style={styles.globalProgressValue}>{acquired}</Text>
          <View style={styles.grow}>
            <Text style={styles.globalProgressTitle}>targets adquiridos</Text>
            <Text style={styles.globalProgressDetail}>de {totalTargets} targets activos en el plan</Text>
          </View>
        </View>
        <ProgressBar max={totalTargets} value={acquired} />
      </Surface>
      {programs.map((program) => <CumulativeCard key={program.id} program={program} />)}
    </View>
  );
}

function ChildPlanSection({ detail }: { detail: ChildDetail }) {
  if (!detail.programs.length) return <EmptyState title="Sin plan activo" detail="Este expediente todavía no tiene programas activos para consultar." />;
  return (
    <View style={styles.sectionStack}>
      {detail.programs.map((program, index) => (
        <Surface key={program.id} accent={index % 3 === 1 ? "yellow" : index % 3 === 2 ? "coral" : "blue"}>
          <View style={styles.rowBetween}>
            <Text style={styles.programTitle}>{program.name}</Text>
            <Pill label={`${program.targets.length} targets`} tone="neutral" />
          </View>
          <View style={styles.planBlock}>
            <Text style={styles.infoLabel}>Objetivo clínico</Text>
            <Text style={styles.bodyText}>{program.objective || "No se ha registrado un objetivo general."}</Text>
          </View>
          <View style={styles.planBlock}>
            <Text style={styles.infoLabel}>Procedimiento e instrucciones</Text>
            <Text style={styles.bodyText}>{program.instructions || "No se han registrado instrucciones adicionales."}</Text>
          </View>
        </Surface>
      ))}
    </View>
  );
}

function ChildDetailScreen({
  child,
  detail,
  loading,
  onBack,
  onCollect,
}: {
  child: ChildSummary;
  detail: ChildDetail | null;
  loading: boolean;
  onBack: () => void;
  onCollect?: () => void;
}) {
  const [section, setSection] = useState<ChildSection>("summary");
  return (
    <ScrollView contentContainerStyle={styles.detailScroll}>
      <PageColumn>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.backText}>Niños</Text>
        </Pressable>
        <View style={styles.profileHero}>
          <View style={styles.profileHeroDecorYellow} />
          <View style={styles.profileHeroDecorCoral} />
          <Avatar child={child} size={72} />
          <View style={styles.grow}>
            <Text style={styles.profileHeroName}>{child.fullName}</Text>
            <Text style={styles.profileHeroMeta}>{[child.internalCode, child.site].filter(Boolean).join(" · ")}</Text>
            <View style={styles.profileHeroPills}>
              <Pill label={`${child.activeProgramCount} programas activos`} tone="warning" />
            </View>
          </View>
        </View>
        <View accessibilityRole="tablist" style={styles.segmentedTabs}>
          {CHILD_SECTIONS.map((item) => {
            const active = item.key === section;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={item.key}
                onPress={() => setSection(item.key)}
                style={[styles.segmentButton, active && styles.segmentButtonActive]}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {onCollect ? <ActionButton label="Recolectar datos · Sesiones" onPress={onCollect} /> : null}
        {loading || !detail ? <LoadingState label="Abriendo expediente…" /> : (
          section === "summary" ? <ChildSummarySection detail={detail} />
            : section === "programs" ? <ChildProgramsSection programs={detail.programs} />
              : section === "progress" ? <ChildProgressSection programs={detail.programs} />
                : <ChildPlanSection detail={detail} />
        )}
      </PageColumn>
    </ScrollView>
  );
}

function CalendarScreen({
  appointments,
  profiles,
  refreshing,
  onRefresh,
  onOpenChild,
}: {
  appointments: Appointment[];
  profiles: ChildSummary[];
  refreshing: boolean;
  onRefresh: () => void;
  onOpenChild: (child: ChildSummary) => void;
}) {
  const today = localDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const dates = useMemo(() => dateRange(today, 15), [today]);
  const upcoming = useMemo(
    () => appointments
      .filter((appointment) => appointment.sessionDate >= today && appointment.status !== "cancelled")
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.startTime.localeCompare(b.startTime)),
    [appointments, today],
  );
  const selectedAppointments = upcoming.filter((appointment) => appointment.sessionDate === selectedDate);

  return (
    <ScrollView
      contentContainerStyle={styles.screenScroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <PageColumn>
        <ScreenIntro title="Mi agenda" detail="Consulta tus sesiones programadas y abre el expediente asignado sin salir del calendario." />
        <DateRail appointments={upcoming} dates={dates} onSelect={setSelectedDate} selected={selectedDate} />
        <Surface accent="blue">
          <Text style={styles.smallOverline}>FECHA SELECCIONADA</Text>
          <Text style={styles.calendarSelectedDate}>{readableDate(selectedDate, true)}</Text>
          <Text style={styles.calendarSelectedMeta}>{selectedAppointments.length} {selectedAppointments.length === 1 ? "sesión programada" : "sesiones programadas"}</Text>
        </Surface>
        <SectionHeading title="Sesiones" />
        {selectedAppointments.length ? selectedAppointments.map((appointment) => {
          const child = profiles.find((candidate) => candidate.id === appointment.profileId);
          return (
            <ScheduleCard
              appointment={appointment}
              child={child}
              key={appointment.id}
              onOpen={child ? () => onOpenChild(child) : undefined}
            />
          );
        }) : (
          <EmptyState title="Agenda libre" detail="No tienes sesiones asignadas para este día." />
        )}
        {upcoming.length ? (
          <>
            <SectionHeading title="Próximas sesiones" trailing={`${upcoming.length} en agenda`} />
            {upcoming.slice(0, 4).map((appointment) => {
              const child = profiles.find((candidate) => candidate.id === appointment.profileId);
              return (
                <ScheduleCard
                  appointment={appointment}
                  child={child}
                  key={`upcoming-${appointment.id}`}
                  onOpen={child ? () => onOpenChild(child) : undefined}
                  showDate
                />
              );
            })}
          </>
        ) : null}
      </PageColumn>
    </ScrollView>
  );
}

function CapabilityRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <View style={styles.capabilityRow}>
      <View style={[styles.capabilityCheck, !enabled && styles.capabilityCheckOff]}>
        <Text style={[styles.capabilityCheckText, !enabled && styles.capabilityCheckTextOff]}>{enabled ? "✓" : "–"}</Text>
      </View>
      <Text style={[styles.capabilityLabel, !enabled && styles.capabilityLabelOff]}>{label}</Text>
      <Text style={[styles.capabilityState, !enabled && styles.capabilityStateOff]}>{enabled ? "Disponible" : "Próximamente"}</Text>
    </View>
  );
}

function ProfileScreen({ bootstrap, onSignOut }: { bootstrap: Bootstrap; onSignOut: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.screenScroll}>
      <PageColumn>
        <ScreenIntro title="Mi perfil" detail="Tu identidad profesional, alcance clínico y funciones móviles." />
        <View style={styles.accountCard}>
          <View style={styles.accountCardMark}><BrandMark size={70} /></View>
          <Text style={styles.accountName}>{bootstrap.account.displayName}</Text>
          <Text style={styles.accountRole}>{bootstrap.account.roleLabel}</Text>
          <View style={styles.accountScope}>
            <Text style={styles.accountScopeValue}>{bootstrap.scope.activeProfileCount}</Text>
            <Text style={styles.accountScopeLabel}>niños disponibles en tu alcance móvil</Text>
          </View>
        </View>
        <Surface>
          <SectionHeading title="Acceso clínico" />
          <InfoRow label="Rol" value={bootstrap.account.roleLabel} />
          {bootstrap.account.siteScope.length ? <InfoRow label="Sedes" value={bootstrap.account.siteScope.join(", ")} /> : null}
          <InfoRow label="Política de acceso" value="Sólo asignaciones y citas propias" />
        </Surface>
        <Surface>
          <SectionHeading title="Funciones de la app" />
          <CapabilityRow enabled={bootstrap.capabilities.viewChildren} label="Expedientes asignados" />
          <CapabilityRow enabled={bootstrap.capabilities.viewPrograms} label="Programas y plan" />
          <CapabilityRow enabled={bootstrap.capabilities.viewGraphs} label="Gráficas de progreso" />
          <CapabilityRow enabled={bootstrap.capabilities.viewCalendar} label="Agenda personal" />
          <CapabilityRow enabled={bootstrap.capabilities.recordSessions} label="Recolección móvil" />
        </Surface>
        <Surface accent="blue">
          <View style={styles.securityRow}>
            <View style={styles.securityIcon}>
              <View style={styles.lockShackle} />
              <View style={styles.lockBody}><View style={styles.lockKeyhole} /></View>
            </View>
            <View style={styles.grow}>
              <Text style={styles.securityTitle}>Acceso protegido</Text>
              <Text style={styles.securityDetail}>La app utiliza tu sesión institucional y solicita los datos mediante la API segura de CIE Nexus.</Text>
            </View>
          </View>
        </Surface>
        <ActionButton label="Cerrar sesión" onPress={onSignOut} variant="coral" />
        <Text style={styles.versionText}>CIE Nexus móvil · Versión 0.4.0</Text>
      </PageColumn>
    </ScrollView>
  );
}

function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      <PageColumn>
        <View accessibilityRole="tablist" style={styles.tabBarRow}>
          {TAB_ITEMS.map((item) => {
            const selected = item.key === active;
            const color = selected ? colors.primary : colors.textSoft;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={item.key}
                onPress={() => onChange(item.key)}
                style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}
              >
                <View style={[styles.tabIconWrap, selected && styles.tabIconWrapActive]}>
                  <NavIcon color={color} name={item.icon} />
                </View>
                <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </PageColumn>
    </View>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    if (!email.trim() || !password) {
      setError("Escribe tu correo y contraseña.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError("No pudimos iniciar sesión. Revisa tus credenciales.");
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.loginSafe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.loginKeyboard}>
        <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.loginHero}>
            <View style={styles.loginCircleYellow} />
            <View style={styles.loginCircleCoral} />
            <View style={styles.loginLogoPlate}><BrandMark size={68} variant="logo" /></View>
            <Text style={styles.loginProduct}>Nexus</Text>
            <Text style={styles.loginProductDetail}>Herramienta clínica móvil</Text>
          </View>
          <View style={styles.loginBody}>
            <View style={styles.loginCard}>
              <Text style={styles.loginTitle}>Acceso profesional</Text>
              <Text style={styles.loginDetail}>Usa la misma cuenta autorizada de CIE Nexus.</Text>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Correo institucional</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="nombre@cie.org.ni"
                  placeholderTextColor={colors.textSoft}
                  returnKeyType="next"
                  style={styles.input}
                  value={email}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Contraseña</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="current-password"
                  onChangeText={setPassword}
                  onSubmitEditing={() => void signIn()}
                  placeholder="Tu contraseña"
                  placeholderTextColor={colors.textSoft}
                  returnKeyType="go"
                  secureTextEntry
                  style={styles.input}
                  value={password}
                />
              </View>
              {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
              <ActionButton disabled={loading} label={loading ? "Ingresando…" : "Ingresar"} onPress={() => void signIn()} />
            </View>
            <View style={styles.loginSecurity}>
              <View style={styles.loginSecurityDot} />
              <Text style={styles.loginSecurityText}>Acceso restringido al personal autorizado</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthenticatedApp({ session }: { session: Session }) {
  const collection = useCollection(session);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionProfileId, setCollectionProfileId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildSummary | null>(null);
  const [childDetail, setChildDetail] = useState<ChildDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const detailGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (!collection.vault) return;
    const generation = ++loadGeneration.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [nextBootstrap, childResult, calendarResult] = await Promise.all([
        mobileGet<Bootstrap>("/bootstrap", session.access_token),
        mobileGet<{ children: ChildSummary[] }>("/children", session.access_token),
        mobileGet<{ appointments: Appointment[] }>("/calendar", session.access_token),
      ]);
      if (generation !== loadGeneration.current) return;
      setBootstrap(nextBootstrap);
      setChildren(childResult.children);
      setAppointments(calendarResult.appointments);
      collection.vault.cache("home", { bootstrap: nextBootstrap, children: childResult.children, appointments: calendarResult.appointments });
    } catch (loadError) {
      if (generation !== loadGeneration.current) return;
      const transient = loadError instanceof MobileApiError && (!loadError.status || loadError.status >= 500);
      const cached = collection.vault.cached<{ bootstrap: Bootstrap; children: ChildSummary[]; appointments: Appointment[] }>("home");
      if (transient && cached) {
        setBootstrap(cached.bootstrap); setChildren(cached.children); setAppointments(cached.appointments);
      }
      if (loadError instanceof MobileApiError && [401,403].includes(loadError.status)) {
        detailGeneration.current++;
        setBootstrap(null); setChildren([]); setAppointments([]); setSelectedChild(null); setChildDetail(null); setCollectionOpen(false);
        collection.vault.clearCache();
      }
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar CIE Nexus.");
    } finally {
      if (generation === loadGeneration.current) { setLoading(false); setRefreshing(false); }
    }
  }, [session.access_token, collection.vault]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openChild = async (child: ChildSummary) => {
    const generation = ++detailGeneration.current;
    setSelectedChild(child);
    setChildDetail(null);
    setLoadingDetail(true);
    try {
      const detail = await mobileGet<ChildDetail>(`/children/${encodeURIComponent(child.id)}`, session.access_token);
      if (generation !== detailGeneration.current) return;
      if (detail.profile.id !== child.id) throw new MobileApiError("El expediente recibido no corresponde al niño seleccionado.", "profile_mismatch", 409);
      collection.vault?.cache(`child:${child.id}`, detail); setChildDetail(detail);
    } catch (detailError) {
      if (generation !== detailGeneration.current) return;
      const transient = detailError instanceof MobileApiError && (!detailError.status || detailError.status >= 500);
      const cached = collection.vault?.cached<ChildDetail>(`child:${child.id}`);
      if (transient && cached?.profile.id === child.id) { setChildDetail(cached); return; }
      if (detailError instanceof MobileApiError && [403,404].includes(detailError.status)) collection.vault?.forget(`child:${child.id}`);
      Alert.alert("No se pudo abrir el expediente", detailError instanceof Error ? detailError.message : "Intenta nuevamente.");
      setSelectedChild(null);
    } finally {
      if (generation === detailGeneration.current) setLoadingDetail(false);
    }
  };

  if (collection.storageError && !collection.vault) return <SafeAreaView style={styles.safe}><View style={styles.fatalState}><EmptyState title="No se pudo abrir el guardado local" detail={collection.storageError}/><ActionButton label="Volver al acceso" onPress={() => void supabase.auth.signOut()}/></View></SafeAreaView>;

  if (loading) {
    return (
      <View style={styles.appLoading}>
        <BrandMark size={86} />
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingLabel}>Preparando CIE Nexus…</Text>
      </View>
    );
  }

  if (!bootstrap) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.fatalState}>
          <EmptyState title="No se pudo iniciar CIE Nexus" detail={error || "Verifica tu conexión e intenta nuevamente."} />
          <ActionButton label="Reintentar" onPress={() => void load()} />
        </View>
      </SafeAreaView>
    );
  }

  const changeTab = (tab: Tab) => {
    setSelectedChild(null);
    setChildDetail(null);
    setActiveTab(tab);
  };

  const openCollection = (profileId: string | null) => { setCollectionProfileId(profileId); setCollectionOpen(true); };
  if (collectionOpen) return <CollectionWorkspace controller={collection} bootstrap={bootstrap} appointments={appointments} accessToken={session.access_token} profileId={collectionProfileId} onBack={() => { setCollectionOpen(false); void load(true); }}/ >;
  const signOut = () => {
    const pending = collection.drafts.some((d) => d.status !== "synced");
    Alert.alert("Cerrar sesión", pending ? "Los registros pendientes quedarán cifrados en este teléfono. Deberás entrar con esta misma cuenta para continuarlos o sincronizarlos." : "Se cerrará tu acceso y se limpiará la información clínica local ya sincronizada.", [
      { text: "Volver", style: "cancel" }, { text: "Cerrar sesión", onPress: () => { if (!pending) collection.vault?.clearSyncedAndCache(); void supabase.auth.signOut(); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar bootstrap={bootstrap} connected={!error} />
      {error ? (
        <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <Text style={styles.errorBannerClose}>×</Text>
        </Pressable>
      ) : null}
      {bootstrap.capabilities.recordSessions ? <Pressable accessibilityRole="button" onPress={() => openCollection(null)} style={styles.collectionBanner}><Text style={styles.collectionBannerTitle}>{collection.drafts.some((d) => d.status === "active") ? "Continuar sesión guardada" : "Recolectar datos"}</Text><Text style={styles.collectionBannerDetail}>{collection.syncing ? "Sincronizando…" : `${collection.drafts.filter((d) => d.status === "pending" || d.status === "conflict").length} pendientes · Abrir sesiones`}</Text></Pressable> : null}
      <View style={styles.main}>
        {selectedChild ? (
          <ChildDetailScreen
            child={selectedChild}
            detail={childDetail}
            loading={loadingDetail}
            onCollect={bootstrap.capabilities.recordSessions ? () => openCollection(selectedChild.id) : undefined}
            onBack={() => {
              detailGeneration.current++;
              setSelectedChild(null);
              setChildDetail(null);
            }}
          />
        ) : activeTab === "today" ? (
          <TodayScreen
            appointments={appointments}
            bootstrap={bootstrap}
            profiles={children}
            onOpenChild={(child) => void openChild(child)}
            onRefresh={() => void load(true)}
            refreshing={refreshing}
          />
        ) : activeTab === "children" ? (
          <ChildrenScreen
            profiles={children}
            onRefresh={() => void load(true)}
            onSelect={(child) => void openChild(child)}
            refreshing={refreshing}
          />
        ) : activeTab === "calendar" ? (
          <CalendarScreen
            appointments={appointments}
            profiles={children}
            onOpenChild={(child) => void openChild(child)}
            onRefresh={() => void load(true)}
            refreshing={refreshing}
          />
        ) : (
          <ProfileScreen bootstrap={bootstrap} onSignOut={signOut} />
        )}
      </View>
      {!selectedChild ? <TabBar active={activeTab} onChange={changeTab} /> : null}
    </SafeAreaView>
  );
}

export default function CieNexusApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  const content = session === undefined ? (
    <View style={styles.appLoading}>
      <BrandMark size={86} />
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  ) : session ? <AuthenticatedApp key={session.user.id} session={session} /> : <LoginScreen />;

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ImmersiveSystemChrome />
      {content}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  collectionBanner: { backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, gap: 4 },
  collectionBannerTitle: { fontSize: 16, fontWeight: "800", color: "#FFFFFF" },
  collectionBannerDetail: { fontSize: 14, color: "#FFFFFF" },
  safe: { backgroundColor: colors.canvas, flex: 1 },
  main: { flex: 1 },
  grow: { flex: 1 },
  pressed: { opacity: 0.72 },
  pageColumn: { alignSelf: "center", paddingHorizontal: 18, width: "100%" },
  pageColumnWide: { maxWidth: 780 },
  screenScroll: { paddingBottom: 34, paddingTop: 22 },
  detailScroll: { paddingBottom: 38, paddingTop: 14 },
  sectionStack: { gap: 13 },
  topBar: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, paddingBottom: 10, paddingTop: 10, ...softShadow },
  topBarRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  topBrand: { alignItems: "center", flexDirection: "row", gap: 9 },
  brandDivider: { backgroundColor: colors.borderStrong, height: 22, width: 1 },
  nexusLabel: { color: colors.textStrong, fontSize: 16, fontWeight: "900", letterSpacing: -0.2 },
  topActions: { alignItems: "center", flexDirection: "row", gap: 9 },
  connectionPill: { alignItems: "center", backgroundColor: colors.successSoft, borderRadius: 999, flexDirection: "row", gap: 6, paddingHorizontal: 9, paddingVertical: 6 },
  connectionDot: { backgroundColor: colors.success, borderRadius: 99, height: 7, width: 7 },
  connectionDotOffline: { backgroundColor: colors.coral },
  connectionText: { color: colors.text, fontSize: 11, fontWeight: "800" },
  accountAvatar: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  accountAvatarText: { color: colors.inkOnPrimary, fontSize: 12, fontWeight: "900" },
  screenIntro: { gap: 5, marginBottom: 17 },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "900", letterSpacing: 0.65, textTransform: "uppercase" },
  screenTitle: { color: colors.textStrong, fontSize: 29, fontWeight: "900", letterSpacing: -0.7, lineHeight: 35 },
  screenDetail: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  sectionHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 6 },
  sectionTitle: { color: colors.textStrong, fontSize: 19, fontWeight: "900", letterSpacing: -0.25 },
  sectionTrailing: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  surface: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, gap: 11, padding: 17, ...softShadow },
  surfaceBlue: { borderLeftColor: colors.primary, borderLeftWidth: 4 },
  surfaceYellow: { borderLeftColor: colors.accent, borderLeftWidth: 4 },
  surfaceCoral: { borderLeftColor: colors.coral, borderLeftWidth: 4 },
  pill: { alignSelf: "flex-start", backgroundColor: "#EEF2F5", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  pillBrand: { backgroundColor: colors.surfaceMuted },
  pillSuccess: { backgroundColor: colors.successSoft },
  pillWarning: { backgroundColor: colors.accentSoft },
  pillCoral: { backgroundColor: colors.coralSoft },
  pillText: { color: colors.textMuted, fontSize: 11, fontWeight: "800" },
  pillTextBrand: { color: colors.primaryDeep },
  pillTextSuccess: { color: colors.success },
  pillTextWarning: { color: colors.warning },
  pillTextCoral: { color: colors.coral },
  actionButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 14, flexDirection: "row", justifyContent: "center", minHeight: 50, paddingHorizontal: 18 },
  actionButtonSecondary: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1 },
  actionButtonQuiet: { alignSelf: "flex-start", backgroundColor: "transparent", minHeight: 42, paddingHorizontal: 0 },
  actionButtonCoral: { backgroundColor: colors.coral },
  actionButtonDisabled: { backgroundColor: "#A9BFCD" },
  actionButtonText: { color: colors.inkOnPrimary, fontSize: 15, fontWeight: "900" },
  actionButtonTextSecondary: { color: colors.primaryDeep },
  buttonArrow: { color: colors.inkOnPrimary, fontSize: 25, fontWeight: "500", marginLeft: 9, marginTop: -2 },
  buttonArrowSecondary: { color: colors.primary },
  avatarImage: { backgroundColor: colors.surfaceMuted },
  avatarFallback: { alignItems: "center", backgroundColor: colors.surfaceStrong, borderColor: "#C4E4F5", borderWidth: 1, justifyContent: "center" },
  avatarText: { color: colors.primaryDeep, fontWeight: "900" },
  emptyState: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, gap: 7, padding: 26, ...softShadow },
  emptyMark: { alignItems: "center", backgroundColor: colors.canvas, borderRadius: 34, height: 68, justifyContent: "center", marginBottom: 3, width: 68 },
  emptyTitle: { color: colors.textStrong, fontSize: 17, fontWeight: "900", textAlign: "center" },
  emptyDetail: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  loadingState: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 260 },
  loadingLabel: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  dateRail: { gap: 9, paddingBottom: 18 },
  dateItem: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, gap: 2, minHeight: 76, paddingHorizontal: 14, paddingVertical: 9, width: 58 },
  dateItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateWeekday: { color: colors.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  dateWeekdayActive: { color: "#DDF2FF" },
  dateNumber: { color: colors.textStrong, fontSize: 22, fontWeight: "900" },
  dateNumberActive: { color: colors.inkOnPrimary },
  dateIndicator: { borderRadius: 99, height: 5, marginTop: 2, width: 5 },
  dateIndicatorBusy: { backgroundColor: colors.coral },
  dateIndicatorToday: { backgroundColor: colors.primary },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 19, marginTop: 16 },
  miniStat: { backgroundColor: colors.surfaceMuted, borderRadius: 16, flex: 1, gap: 4, minHeight: 82, padding: 12 },
  miniStatYellow: { backgroundColor: colors.accentSoft },
  miniStatCoral: { backgroundColor: colors.coralSoft },
  miniStatValue: { color: colors.primaryDeep, fontSize: 24, fontWeight: "900" },
  miniStatValueYellow: { color: colors.warning },
  miniStatValueCoral: { color: colors.coral },
  miniStatLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "800", lineHeight: 14 },
  nextCard: { backgroundColor: colors.primary, borderRadius: 24, gap: 17, overflow: "hidden", padding: 19, ...shadow },
  nextAccentYellow: { backgroundColor: colors.accent, borderRadius: 45, height: 90, opacity: 0.95, position: "absolute", right: -24, top: -39, width: 90 },
  nextAccentCoral: { backgroundColor: colors.coral, borderRadius: 24, height: 48, position: "absolute", right: 42, top: -28, transform: [{ rotate: "28deg" }], width: 48 },
  nextCardTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  nextEyebrow: { color: "#DDF3FF", fontSize: 11, fontWeight: "900", letterSpacing: 0.65, textTransform: "uppercase" },
  nextTime: { color: colors.inkOnPrimary, fontSize: 25, fontWeight: "900", letterSpacing: -0.4, marginTop: 3 },
  nextChildRow: { alignItems: "center", flexDirection: "row", gap: 13 },
  nextChildName: { color: colors.inkOnPrimary, fontSize: 19, fontWeight: "900" },
  nextMeta: { color: "#DDF3FF", fontSize: 13, lineHeight: 18 },
  scheduleRow: { alignItems: "stretch", flexDirection: "row", minHeight: 120 },
  scheduleTimeColumn: { alignItems: "flex-start", paddingTop: 13, position: "relative", width: 63 },
  scheduleTime: { color: colors.textStrong, fontSize: 15, fontWeight: "900" },
  scheduleEnd: { color: colors.textSoft, fontSize: 11, marginTop: 1 },
  timelineDot: { backgroundColor: colors.primary, borderColor: colors.canvas, borderRadius: 7, borderWidth: 3, height: 14, position: "absolute", right: 1, top: 18, width: 14, zIndex: 2 },
  timelineLine: { backgroundColor: colors.borderStrong, bottom: -10, position: "absolute", right: 7, top: 31, width: 1 },
  scheduleCardBody: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flex: 1, gap: 7, marginBottom: 10, padding: 14, ...softShadow },
  rowBetween: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  scheduleDate: { color: colors.primary, fontSize: 11, fontWeight: "900", marginBottom: 2, textTransform: "capitalize" },
  cardTitle: { color: colors.textStrong, fontSize: 16, fontWeight: "900" },
  cardMeta: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  appointmentNote: { backgroundColor: colors.canvas, borderRadius: 10, color: colors.text, fontSize: 13, lineHeight: 18, padding: 9 },
  inlineAction: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", marginTop: 2 },
  inlineActionText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  inlineArrow: { color: colors.primary, fontSize: 20, marginLeft: 4, marginTop: -2 },
  searchBox: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", minHeight: 52, paddingHorizontal: 14, ...softShadow },
  searchGlyph: { height: 22, marginRight: 9, position: "relative", width: 22 },
  searchCircle: { borderColor: colors.textSoft, borderRadius: 7, borderWidth: 2, height: 13, left: 1, position: "absolute", top: 1, width: 13 },
  searchHandle: { backgroundColor: colors.textSoft, height: 2, left: 12, position: "absolute", top: 13, transform: [{ rotate: "45deg" }], width: 8 },
  searchInput: { color: colors.text, flex: 1, fontSize: 15, minHeight: 50, paddingVertical: 0 },
  clearSearch: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  clearSearchText: { color: colors.textMuted, fontSize: 24, fontWeight: "500" },
  childCard: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 13, marginBottom: 11, padding: 15, ...softShadow },
  childName: { color: colors.textStrong, fontSize: 17, fontWeight: "900" },
  childFooter: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 5 },
  childCode: { color: colors.textSoft, fontSize: 11, fontWeight: "800" },
  cardChevron: { color: colors.primary, fontSize: 30, fontWeight: "400" },
  backButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", marginBottom: 10, minHeight: 38, paddingRight: 12 },
  backArrow: { color: colors.primary, fontSize: 28, marginRight: 4, marginTop: -3 },
  backText: { color: colors.primaryDeep, fontSize: 15, fontWeight: "900" },
  profileHero: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 23, flexDirection: "row", gap: 14, overflow: "hidden", padding: 18, ...shadow },
  profileHeroDecorYellow: { backgroundColor: colors.accent, borderRadius: 38, height: 76, position: "absolute", right: -16, top: -34, width: 76 },
  profileHeroDecorCoral: { backgroundColor: colors.coral, borderRadius: 18, height: 36, position: "absolute", right: 47, top: -20, transform: [{ rotate: "32deg" }], width: 36 },
  profileHeroName: { color: colors.inkOnPrimary, fontSize: 21, fontWeight: "900" },
  profileHeroMeta: { color: "#DDF3FF", fontSize: 13, marginTop: 3 },
  profileHeroPills: { flexDirection: "row", marginTop: 7 },
  segmentedTabs: { backgroundColor: "#E7F0F6", borderRadius: 14, flexDirection: "row", marginBottom: 16, marginTop: 14, padding: 4 },
  segmentButton: { alignItems: "center", borderRadius: 11, flex: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 4 },
  segmentButtonActive: { backgroundColor: colors.surface, ...softShadow },
  segmentLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  segmentLabelActive: { color: colors.primaryDeep },
  infoRow: { borderTopColor: colors.border, borderTopWidth: 1, gap: 3, paddingTop: 10 },
  infoLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "900", letterSpacing: 0.35, textTransform: "uppercase" },
  infoValue: { color: colors.text, fontSize: 15, lineHeight: 21 },
  progressTrack: { backgroundColor: "#E6EEF3", borderRadius: 99, height: 9, overflow: "hidden" },
  progressFill: { backgroundColor: colors.primary, borderRadius: 99, height: "100%" },
  targetList: { borderTopColor: colors.border, borderTopWidth: 1, gap: 0, paddingTop: 2 },
  targetRow: { alignItems: "flex-start", borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 12 },
  targetStatusMark: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 34, justifyContent: "center", width: 34 },
  targetStatusMarkDone: { backgroundColor: colors.successSoft },
  targetStatusText: { color: colors.primaryDeep, fontSize: 10, fontWeight: "900" },
  targetStatusTextDone: { color: colors.success, fontSize: 16 },
  targetName: { color: colors.textStrong, fontSize: 14, fontWeight: "900", lineHeight: 18 },
  targetObjective: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  measurementText: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 4 },
  programTitle: { color: colors.textStrong, flex: 1, fontSize: 17, fontWeight: "900", lineHeight: 21 },
  programMeta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  programObjective: { color: colors.text, fontSize: 14, lineHeight: 20 },
  expandButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.canvas, borderRadius: 12, flexDirection: "row", justifyContent: "space-between", minHeight: 43, paddingHorizontal: 13 },
  expandButtonText: { color: colors.primaryDeep, fontSize: 13, fontWeight: "900" },
  expandArrow: { color: colors.primary, fontSize: 18, fontWeight: "900" },
  totalBadge: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: 14, minWidth: 68, paddingHorizontal: 10, paddingVertical: 8 },
  totalBadgeValue: { color: colors.primaryDeep, fontSize: 21, fontWeight: "900" },
  totalBadgeLabel: { color: colors.textMuted, fontSize: 9, fontWeight: "800" },
  chart: { height: 146, marginTop: 5, position: "relative" },
  chartGridLineTop: { backgroundColor: colors.border, height: 1, left: 0, position: "absolute", right: 0, top: 15 },
  chartGridLineMiddle: { backgroundColor: colors.border, height: 1, left: 0, position: "absolute", right: 0, top: 72 },
  chartGridLineBottom: { backgroundColor: colors.borderStrong, bottom: 0, height: 1, left: 0, position: "absolute", right: 0 },
  chartBars: { alignItems: "flex-end", bottom: 1, flexDirection: "row", gap: 7, height: 130, justifyContent: "space-around", left: 4, position: "absolute", right: 4 },
  chartBarSlot: { alignItems: "center", flex: 1, height: "100%", justifyContent: "flex-end", maxWidth: 34 },
  chartValue: { color: colors.textSoft, fontSize: 9, fontWeight: "800", marginBottom: 3 },
  chartValueLatest: { color: colors.primaryDeep },
  chartBar: { backgroundColor: "#B9DFF4", borderTopLeftRadius: 5, borderTopRightRadius: 5, minHeight: 8, width: "72%" },
  chartBarLatest: { backgroundColor: colors.primary },
  chartDates: { flexDirection: "row", justifyContent: "space-between" },
  chartDate: { color: colors.textSoft, fontSize: 10, fontWeight: "700" },
  chartEmpty: { alignItems: "center", backgroundColor: colors.canvas, borderRadius: 14, gap: 5, padding: 18 },
  chartEmptyTitle: { color: colors.textStrong, fontSize: 14, fontWeight: "900", textAlign: "center" },
  chartEmptyDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
  progressSummary: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  progressSummaryLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  progressSummaryValue: { color: colors.primaryDeep, fontSize: 13, fontWeight: "900" },
  planPreview: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 11 },
  planNumber: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  planNumberText: { color: colors.primaryDeep, fontSize: 15, fontWeight: "900" },
  planPreviewTitle: { color: colors.textStrong, fontSize: 14, fontWeight: "900" },
  planPreviewDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  smallOverline: { color: colors.primaryDeep, fontSize: 11, fontWeight: "900", letterSpacing: 0.55 },
  bodyText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  globalProgressRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  globalProgressValue: { color: colors.primary, fontSize: 42, fontWeight: "900", letterSpacing: -1 },
  globalProgressTitle: { color: colors.textStrong, fontSize: 16, fontWeight: "900" },
  globalProgressDetail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  planBlock: { borderTopColor: colors.border, borderTopWidth: 1, gap: 5, paddingTop: 10 },
  calendarSelectedDate: { color: colors.textStrong, fontSize: 22, fontWeight: "900", textTransform: "capitalize" },
  calendarSelectedMeta: { color: colors.textMuted, fontSize: 13 },
  capabilityRow: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 10 },
  capabilityCheck: { alignItems: "center", backgroundColor: colors.successSoft, borderRadius: 11, height: 28, justifyContent: "center", width: 28 },
  capabilityCheckOff: { backgroundColor: "#EEF2F5" },
  capabilityCheckText: { color: colors.success, fontSize: 14, fontWeight: "900" },
  capabilityCheckTextOff: { color: colors.textSoft },
  capabilityLabel: { color: colors.text, flex: 1, fontSize: 13, fontWeight: "800" },
  capabilityLabelOff: { color: colors.textMuted },
  capabilityState: { color: colors.success, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  capabilityStateOff: { color: colors.textSoft },
  accountCard: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 24, overflow: "hidden", padding: 22, ...shadow },
  accountCardMark: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 48, height: 96, justifyContent: "center", marginBottom: 10, width: 96 },
  accountName: { color: colors.inkOnPrimary, fontSize: 22, fontWeight: "900", textAlign: "center" },
  accountRole: { color: "#DDF3FF", fontSize: 13, fontWeight: "700", marginTop: 3 },
  accountScope: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.13)", borderRadius: 15, flexDirection: "row", gap: 9, marginTop: 16, paddingHorizontal: 14, paddingVertical: 10 },
  accountScopeValue: { color: colors.accent, fontSize: 24, fontWeight: "900" },
  accountScopeLabel: { color: colors.inkOnPrimary, fontSize: 12, fontWeight: "700", maxWidth: 190 },
  securityRow: { alignItems: "center", flexDirection: "row", gap: 13 },
  securityIcon: { alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: 18, height: 52, justifyContent: "center", position: "relative", width: 52 },
  lockShackle: { borderColor: colors.primary, borderRadius: 7, borderWidth: 2, height: 13, position: "absolute", top: 10, width: 15 },
  lockBody: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 5, height: 18, justifyContent: "center", position: "absolute", top: 22, width: 23 },
  lockKeyhole: { backgroundColor: colors.surface, borderRadius: 2, height: 6, width: 3 },
  securityTitle: { color: colors.textStrong, fontSize: 15, fontWeight: "900" },
  securityDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  versionText: { color: colors.textSoft, fontSize: 11, marginTop: 3, textAlign: "center" },
  tabBar: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, paddingBottom: Platform.OS === "ios" ? 8 : 5, paddingTop: 6, ...softShadow },
  tabBarRow: { flexDirection: "row" },
  tabButton: { alignItems: "center", flex: 1, gap: 2, justifyContent: "center", minHeight: 57 },
  tabIconWrap: { alignItems: "center", borderRadius: 13, height: 31, justifyContent: "center", width: 46 },
  tabIconWrapActive: { backgroundColor: colors.surfaceMuted },
  tabLabel: { color: colors.textSoft, fontSize: 10, fontWeight: "800" },
  tabLabelActive: { color: colors.primaryDeep },
  loginSafe: { backgroundColor: colors.primary, flex: 1 },
  loginKeyboard: { flex: 1 },
  loginScroll: { flexGrow: 1 },
  loginHero: { alignItems: "center", backgroundColor: colors.primary, justifyContent: "center", minHeight: 270, overflow: "hidden", padding: 30 },
  loginCircleYellow: { backgroundColor: colors.accent, borderRadius: 72, height: 144, opacity: 0.97, position: "absolute", right: -44, top: -48, width: 144 },
  loginCircleCoral: { backgroundColor: colors.coral, borderRadius: 36, height: 72, left: -24, position: "absolute", top: 42, transform: [{ rotate: "30deg" }], width: 72 },
  loginLogoPlate: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 20, justifyContent: "center", minHeight: 95, paddingHorizontal: 22, width: 230, ...shadow },
  loginProduct: { color: colors.inkOnPrimary, fontSize: 27, fontWeight: "900", letterSpacing: 0.2, marginTop: 13 },
  loginProductDetail: { color: "#DDF3FF", fontSize: 13, fontWeight: "700", marginTop: 2 },
  loginBody: { backgroundColor: colors.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, flex: 1, marginTop: -22, padding: 20, paddingTop: 27 },
  loginCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 22, borderWidth: 1, gap: 16, padding: 20, ...shadow },
  loginTitle: { color: colors.textStrong, fontSize: 22, fontWeight: "900" },
  loginDetail: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  fieldGroup: { gap: 7 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "800" },
  input: { backgroundColor: colors.canvas, borderColor: colors.border, borderRadius: 13, borderWidth: 1, color: colors.textStrong, fontSize: 16, minHeight: 51, paddingHorizontal: 14 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  loginSecurity: { alignItems: "center", flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 17 },
  loginSecurityDot: { backgroundColor: colors.success, borderRadius: 99, height: 7, width: 7 },
  loginSecurityText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  appLoading: { alignItems: "center", backgroundColor: colors.canvas, flex: 1, gap: 17, justifyContent: "center" },
  fatalState: { flex: 1, gap: 14, justifyContent: "center", padding: 22 },
  errorBanner: { alignItems: "center", backgroundColor: colors.coralSoft, flexDirection: "row", justifyContent: "center", minHeight: 42, paddingHorizontal: 16 },
  errorBannerText: { color: colors.danger, flex: 1, fontSize: 12, fontWeight: "800", textAlign: "center" },
  errorBannerClose: { color: colors.danger, fontSize: 21, marginLeft: 8 },
});
