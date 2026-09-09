export type TargetMethod = "interview" | "verification";
export type AreaRoute = "all" | "4A" | "4B";
export type PackageStatus = "draft" | "active" | "archived";

export type EvaluationTarget = {
  id?: string;
  code: string;
  title: string;
  criterion: string;
  alert?: boolean;
  methods?: TargetMethod[];
};

export type EvaluationArea = {
  key: string;
  label: string;
  short: string;
  description?: string;
  route?: AreaRoute;
  items: EvaluationTarget[];
};

export type EvaluationPackageDefinition = {
  id: string;
  familyId: string;
  name: string;
  objective: string;
  version: number;
  status: PackageStatus;
  areas: EvaluationArea[];
  createdAt?: string;
  updatedAt?: string;
};

const combinedMethods: TargetMethod[] = ["interview", "verification"];

export const DEFAULT_EVALUATION_PACKAGE: EvaluationPackageDefinition = {
  id: "imc-aba-v1",
  familyId: "imc-aba",
  name: "Instrumento de mejora de competencias ABA",
  objective: "Identificar fortalezas y brechas observables en la formulación, implementación y toma de decisiones de programas ABA para orientar una enseñanza específica y comprobar posteriormente la mejora con el mismo instrumento.",
  version: 1,
  status: "active",
  areas: [
    {
      key: "p1", label: "Área 1", short: "Validez social", route: "all", items: [
        { code: "VS-01", title: "Relevancia del objetivo", criterion: "Vincula el objetivo con un beneficio concreto en comunicación, autonomía, seguridad, acceso o participación cotidiana.", methods: combinedMethods },
        { code: "VS-02", title: "Perspectiva directa del participante", criterion: "Identifica señales individualizadas de elección, aproximación, continuación, evitación o rechazo y las usa para decidir.", alert: true, methods: combinedMethods },
        { code: "VS-03", title: "Aceptabilidad y viabilidad", criterion: "El procedimiento es aceptable y factible dentro de rutinas, tiempo, recursos y capacidades reales.", methods: combinedMethods },
        { code: "VS-04", title: "Importancia de los resultados", criterion: "Comprueba beneficio cotidiano, cargas o efectos no deseados y usa esa evidencia para mantener o modificar.", methods: combinedMethods },
      ],
    },
    {
      key: "p2", label: "Área 2", short: "Evaluación y formulación", route: "all", items: [
        { code: "EFC-01", title: "Evaluación directa del desempeño", criterion: "Observa y mide antes de formular el programa, distinguiendo independencia, ayudas, errores o conducta objetivo.", methods: combinedMethods },
        { code: "EFC-02", title: "Evaluación individualizada y contextual", criterion: "Considera variables relevantes del participante y el contexto, sin depender solo de diagnósticos o reportes.", methods: combinedMethods },
        { code: "EFC-03", title: "Formulación sustentada y delimitada", criterion: "Diferencia observaciones, reportes e hipótesis, reconoce contradicciones, alternativas y límites.", alert: true, methods: combinedMethods },
        { code: "EFC-04", title: "Correspondencia evaluación–programa", criterion: "El objetivo y los componentes iniciales se derivan explícitamente de los resultados de evaluación.", methods: combinedMethods },
      ],
    },
    {
      key: "p3", label: "Área 3", short: "Objetivos y plan", route: "all", items: [
        { code: "OPT-01", title: "Priorización y secuenciación", criterion: "Prioriza con criterios explícitos, considera el repertorio actual, prerrequisitos y habilidades posteriores.", methods: combinedMethods },
        { code: "OPT-02", title: "Objetivo observable y medible", criterion: "Especifica conducta, condiciones, independencia y criterio de logro sin exigir interpretación adicional.", methods: combinedMethods },
        { code: "OPT-03", title: "Organización operativa del plan", criterion: "Define quién implementa, contextos, frecuencia u oportunidades, recursos y coordinación.", methods: combinedMethods },
        { code: "OPT-04", title: "Dominio y desempeño duradero", criterion: "Establece dominio, generalización, mantenimiento, retorno a enseñanza y calendario de revisión.", methods: combinedMethods },
      ],
    },
    {
      key: "p4a", label: "Área 4A", short: "Adquisición de habilidades", route: "4A", items: [
        { code: "PAH-01", title: "Oportunidad de aprendizaje", criterion: "Especifica estímulo relevante, instrucciones, materiales, ejemplos y control de claves involuntarias.", methods: combinedMethods },
        { code: "PAH-02", title: "Ayudas y transferencia de control", criterion: "Define tipo, momento, secuencia, desvanecimiento y reglas para avanzar o retroceder.", methods: combinedMethods },
        { code: "PAH-03", title: "Consecuencias y reforzamiento", criterion: "Diferencia respuestas independientes y ayudadas, con reforzadores actuales y entrega orientada a independencia.", methods: combinedMethods },
        { code: "PAH-04", title: "Prevención y corrección de errores", criterion: "Define respuesta tras error o ausencia, nueva oportunidad correcta y reglas para modificar el procedimiento.", methods: combinedMethods },
      ],
    },
    {
      key: "p4b", label: "Área 4B", short: "Conducta que interfiere", route: "4B", items: [
        { code: "CTI-01", title: "Correspondencia funcional", criterion: "Relaciona cada componente con la función o variables mantenedoras y revisa el plan ante discrepancias.", alert: true, methods: combinedMethods },
        { code: "CTI-02", title: "Respuesta alternativa funcional", criterion: "Enseña una alternativa eficiente y accesible que obtiene el mismo resultado, junto con tolerancia o espera.", methods: combinedMethods },
        { code: "CTI-03", title: "Antecedentes y contingencias", criterion: "Especifica prevención, señales y consecuencias, además del desvanecimiento a condiciones naturales.", methods: combinedMethods },
        { code: "CTI-04", title: "Seguridad, dignidad y efectos adversos", criterion: "Define riesgos, prevención, pausa o terminación, escalamiento y monitoreo de rechazo y efectos adversos.", alert: true, methods: combinedMethods },
      ],
    },
    {
      key: "p5", label: "Área 5", short: "Medición y decisiones", route: "all", items: [
        { code: "MGD-01", title: "Sistema de medición representativo", criterion: "Usa definición, dimensión, unidad y procedimiento compatibles con la conducta y el contexto.", alert: true, methods: combinedMethods },
        { code: "MGD-02", title: "Integridad y trazabilidad", criterion: "Reconstruye valores desde el dato original y distingue ayudas, errores, ceros y datos ausentes.", alert: true, methods: combinedMethods },
        { code: "MGD-03", title: "Representación y análisis gráfico", criterion: "Representa correctamente y analiza nivel, tendencia y variabilidad sin exceder el diseño.", methods: combinedMethods },
        { code: "MGD-04", title: "Decisiones clínicas basadas en datos", criterion: "Relaciona continuar, modificar o recopilar más información con patrón, criterios y relevancia clínica.", methods: combinedMethods },
      ],
    },
  ],
};

function fallbackId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `package-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePackageDefinition(value: unknown): EvaluationPackageDefinition {
  const raw = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value;
  if (!raw || typeof raw !== "object") return DEFAULT_EVALUATION_PACKAGE;
  const candidate = raw as Partial<EvaluationPackageDefinition>;
  const areas: EvaluationArea[] = Array.isArray(candidate.areas) ? candidate.areas.map((area, areaIndex): EvaluationArea => ({
    key: String(area.key || `area-${areaIndex + 1}`),
    label: String(area.label || `Área ${areaIndex + 1}`),
    short: String(area.short || "Área sin nombre"),
    description: String(area.description || ""),
    route: area.route === "4A" || area.route === "4B" ? area.route : "all",
    items: Array.isArray(area.items) ? area.items.map((item, itemIndex) => ({
      id: String(item.id || `${area.key || areaIndex}-${itemIndex + 1}`),
      code: String(item.code || `T-${itemIndex + 1}`),
      title: String(item.title || "Target sin nombre"),
      criterion: String(item.criterion || ""),
      alert: Boolean(item.alert),
      methods: Array.isArray(item.methods) && item.methods.length
        ? item.methods.filter((method): method is TargetMethod => method === "interview" || method === "verification")
        : combinedMethods,
    })) : [],
  })) : [];
  return {
    id: String(candidate.id || fallbackId()),
    familyId: String(candidate.familyId || candidate.id || fallbackId()),
    name: String(candidate.name || "Paquete sin nombre"),
    objective: String(candidate.objective || ""),
    version: Number(candidate.version) || 1,
    status: candidate.status === "draft" || candidate.status === "archived" ? candidate.status : "active",
    areas,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

export function areasForPackage(definition: EvaluationPackageDefinition, route: "4A" | "4B") {
  return definition.areas.filter((area) => !area.route || area.route === "all" || area.route === route);
}

export function targetsForPackage(definition: EvaluationPackageDefinition, route: "4A" | "4B") {
  return areasForPackage(definition, route).flatMap((area) => area.items);
}

export function packageVersionLabel(definition: EvaluationPackageDefinition) {
  return `${definition.name} · v${definition.version}.0`;
}
