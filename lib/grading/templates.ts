import type { RubricCriterion } from "./assignment";

/** Rubric templates (§3.1 option 3), ES + EN. Copied into the assignment as a frozen snapshot. */
type Template = {
  id: string;
  title: { es: string; en: string };
  criteria: { es: RubricCriterion[]; en: RubricCriterion[] };
};

const lv = (labels: string[], descriptors: string[]) =>
  labels.map((label, i) => ({ label, points: labels.length - i, descriptor: descriptors[i] }));

const ES4 = ["Destacado", "Logrado", "En proceso", "Inicio"];
const EN4 = ["Exceeds", "Meets", "Approaching", "Beginning"];

export const RUBRIC_TEMPLATES: Template[] = [
  {
    id: "writing",
    title: { es: "Escritura (párrafo o texto breve)", en: "Writing (paragraph or short text)" },
    criteria: {
      es: [
        {
          key: "ideas",
          title: "Ideas y contenido",
          description: "Idea principal clara, apoyada con detalles.",
          levels: lv(ES4, [
            "Idea principal clara con detalles precisos y relevantes.",
            "Idea principal clara con algunos detalles.",
            "Idea principal poco clara o con pocos detalles.",
            "No se identifica una idea principal.",
          ]),
        },
        {
          key: "organization",
          title: "Organización",
          description: "Inicio, desarrollo y cierre; conectores.",
          levels: lv(ES4, [
            "Estructura completa y conectores variados.",
            "Estructura completa con conectores básicos.",
            "Estructura incompleta o desordenada.",
            "Sin estructura reconocible.",
          ]),
        },
        {
          key: "conventions",
          title: "Ortografía y gramática",
          description: "Ortografía, acentuación, puntuación y concordancia.",
          levels: lv(ES4, [
            "Casi sin errores.",
            "Errores menores que no dificultan la lectura.",
            "Errores frecuentes que a veces dificultan la lectura.",
            "Errores que impiden entender el texto.",
          ]),
        },
        {
          key: "voice",
          title: "Vocabulario y estilo",
          description: "Palabras precisas y adecuadas al propósito.",
          levels: lv(ES4, [
            "Vocabulario preciso y variado.",
            "Vocabulario adecuado.",
            "Vocabulario repetitivo o impreciso.",
            "Vocabulario muy limitado.",
          ]),
        },
      ],
      en: [
        {
          key: "ideas",
          title: "Ideas and content",
          description: "Clear main idea supported by details.",
          levels: lv(EN4, [
            "Clear main idea with precise, relevant details.",
            "Clear main idea with some details.",
            "Unclear main idea or few details.",
            "No identifiable main idea.",
          ]),
        },
        {
          key: "organization",
          title: "Organization",
          description: "Beginning, middle, end; transitions.",
          levels: lv(EN4, [
            "Complete structure with varied transitions.",
            "Complete structure with basic transitions.",
            "Incomplete or disordered structure.",
            "No recognizable structure.",
          ]),
        },
        {
          key: "conventions",
          title: "Spelling and grammar",
          description: "Spelling, punctuation, agreement.",
          levels: lv(EN4, [
            "Almost no errors.",
            "Minor errors that don't affect reading.",
            "Frequent errors that sometimes affect reading.",
            "Errors make the text hard to understand.",
          ]),
        },
        {
          key: "voice",
          title: "Word choice and style",
          description: "Precise words suited to the purpose.",
          levels: lv(EN4, [
            "Precise, varied vocabulary.",
            "Appropriate vocabulary.",
            "Repetitive or imprecise vocabulary.",
            "Very limited vocabulary.",
          ]),
        },
      ],
    },
  },
  {
    id: "math_problem_solving",
    title: { es: "Resolución de problemas (matemática)", en: "Math problem solving" },
    criteria: {
      es: [
        {
          key: "understanding",
          title: "Comprensión del problema",
          description: "Identifica datos y lo que se pide.",
          levels: lv(ES4, [
            "Identifica todos los datos y la pregunta.",
            "Identifica los datos principales.",
            "Identifica datos parcialmente.",
            "No identifica qué se pide.",
          ]),
        },
        {
          key: "strategy",
          title: "Estrategia",
          description: "Elige y aplica un procedimiento adecuado.",
          levels: lv(ES4, [
            "Estrategia eficiente y bien aplicada.",
            "Estrategia adecuada.",
            "Estrategia parcialmente adecuada.",
            "Sin estrategia o inadecuada.",
          ]),
        },
        {
          key: "accuracy",
          title: "Cálculos",
          description: "Operaciones correctas.",
          levels: lv(ES4, [
            "Sin errores de cálculo.",
            "Un error menor.",
            "Varios errores.",
            "Errores que invalidan el resultado.",
          ]),
        },
        {
          key: "communication",
          title: "Comunicación",
          description: "Muestra el procedimiento y da la respuesta con unidades.",
          levels: lv(ES4, [
            "Procedimiento claro y respuesta completa.",
            "Procedimiento visible, respuesta clara.",
            "Procedimiento incompleto.",
            "Solo un número o nada.",
          ]),
        },
      ],
      en: [
        {
          key: "understanding",
          title: "Understanding",
          description: "Identifies the data and what is asked.",
          levels: lv(EN4, [
            "Identifies all data and the question.",
            "Identifies the main data.",
            "Partially identifies the data.",
            "Does not identify what is asked.",
          ]),
        },
        {
          key: "strategy",
          title: "Strategy",
          description: "Chooses and applies a suitable method.",
          levels: lv(EN4, [
            "Efficient, well-applied strategy.",
            "Suitable strategy.",
            "Partly suitable strategy.",
            "No or unsuitable strategy.",
          ]),
        },
        {
          key: "accuracy",
          title: "Accuracy",
          description: "Correct calculations.",
          levels: lv(EN4, [
            "No calculation errors.",
            "One minor error.",
            "Several errors.",
            "Errors invalidate the result.",
          ]),
        },
        {
          key: "communication",
          title: "Communication",
          description: "Shows the work and answers with units.",
          levels: lv(EN4, [
            "Clear work and complete answer.",
            "Visible work, clear answer.",
            "Incomplete work.",
            "Only a number or nothing.",
          ]),
        },
      ],
    },
  },
  {
    id: "reading",
    title: { es: "Comprensión lectora", en: "Reading comprehension" },
    criteria: {
      es: [
        {
          key: "literal",
          title: "Comprensión literal",
          description: "Recupera información explícita.",
          levels: lv(ES4, [
            "Información completa y precisa.",
            "Información correcta.",
            "Información parcial.",
            "Información incorrecta o ausente.",
          ]),
        },
        {
          key: "inferential",
          title: "Comprensión inferencial",
          description: "Deduce ideas no explícitas.",
          levels: lv(ES4, [
            "Inferencias bien justificadas con el texto.",
            "Inferencias razonables.",
            "Inferencias poco fundamentadas.",
            "No realiza inferencias.",
          ]),
        },
        {
          key: "evidence",
          title: "Uso de evidencia",
          description: "Cita el texto para apoyar sus respuestas.",
          levels: lv(ES4, ["Cita evidencia pertinente.", "Usa alguna evidencia.", "Evidencia vaga.", "Sin evidencia."]),
        },
      ],
      en: [
        {
          key: "literal",
          title: "Literal comprehension",
          description: "Retrieves explicit information.",
          levels: lv(EN4, [
            "Complete, precise information.",
            "Correct information.",
            "Partial information.",
            "Incorrect or missing information.",
          ]),
        },
        {
          key: "inferential",
          title: "Inferential comprehension",
          description: "Infers ideas not stated.",
          levels: lv(EN4, [
            "Well-supported inferences.",
            "Reasonable inferences.",
            "Weakly supported inferences.",
            "No inferences.",
          ]),
        },
        {
          key: "evidence",
          title: "Use of evidence",
          description: "Cites the text to support answers.",
          levels: lv(EN4, ["Cites relevant evidence.", "Uses some evidence.", "Vague evidence.", "No evidence."]),
        },
      ],
    },
  },
  {
    id: "lab_report",
    title: { es: "Informe de laboratorio", en: "Lab report" },
    criteria: {
      es: [
        {
          key: "hypothesis",
          title: "Hipótesis",
          description: "Clara y comprobable.",
          levels: lv(ES4, ["Clara, comprobable y fundamentada.", "Clara y comprobable.", "Vaga.", "Ausente."]),
        },
        {
          key: "procedure",
          title: "Procedimiento y datos",
          description: "Pasos y datos registrados con unidades.",
          levels: lv(ES4, ["Completo y ordenado, con unidades.", "Completo.", "Incompleto.", "Ausente."]),
        },
        {
          key: "analysis",
          title: "Análisis y conclusión",
          description: "Interpreta los datos y responde a la hipótesis.",
          levels: lv(ES4, [
            "Conclusión basada en los datos.",
            "Conclusión coherente.",
            "Conclusión poco relacionada con los datos.",
            "Sin conclusión.",
          ]),
        },
      ],
      en: [
        {
          key: "hypothesis",
          title: "Hypothesis",
          description: "Clear and testable.",
          levels: lv(EN4, ["Clear, testable and reasoned.", "Clear and testable.", "Vague.", "Missing."]),
        },
        {
          key: "procedure",
          title: "Procedure and data",
          description: "Steps and data recorded with units.",
          levels: lv(EN4, ["Complete, ordered, with units.", "Complete.", "Incomplete.", "Missing."]),
        },
        {
          key: "analysis",
          title: "Analysis and conclusion",
          description: "Interprets the data and answers the hypothesis.",
          levels: lv(EN4, [
            "Conclusion grounded in the data.",
            "Coherent conclusion.",
            "Conclusion loosely tied to data.",
            "No conclusion.",
          ]),
        },
      ],
    },
  },
];
