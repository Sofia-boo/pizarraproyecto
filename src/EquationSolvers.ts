import { all, create } from 'mathjs'

const engine = create(all, {})

export type EquationResult = {
  title: string
  answers: string[]
  steps: string[]
  kind: 'quadratic' | 'linear' | 'identity' | 'inconsistent'
}

const safeVariables = new Set(['x', 'pi', 'e', 'tau'])
const safeFunctions = new Set(['sqrt'])
const EPS = 1e-9

export function displayNumber(value: number): string {
  if (Math.abs(value) < 1e-10) return '0'
  const rounded = Number(value.toPrecision(9))
  return String(rounded)
}

function normalizeEquation(source: string): string {
  let text = source.trim()
    .replace(/[−–]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/\^\{([^{}]+)\}/g, '^($1)')
    .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\s+/g, '')
  // La calculadora está en español; interpreta 1,5 como 1.5.
  text = text.replace(/(\d),(\d)/g, '$1.$2')
  if (text.length > 170) throw new Error('La ecuación es demasiado larga.')
  if (!text) throw new Error('Escribí una ecuación para resolver.')
  return text
}

function compiledSide(expression: string): (x: number) => number {
  if (!expression) throw new Error('Falta un miembro de la ecuación.')
  const ast = engine.parse(expression)
  ast.traverse((node: { type: string; name?: string; fn?: { type?: string; name?: string }; op?: string }) => {
    if (!['OperatorNode', 'ConstantNode', 'ParenthesisNode', 'SymbolNode', 'FunctionNode'].includes(node.type)) {
      throw new Error('La ecuación contiene una operación no admitida.')
    }
    if (node.type === 'OperatorNode' && !['+', '-', '*', '/', '^'].includes(node.op ?? '')) {
      throw new Error('Solo se admiten sumas, restas, productos, divisiones y potencias.')
    }
    if (node.type === 'SymbolNode' && !safeVariables.has(node.name ?? '') && !safeFunctions.has(node.name ?? '')) {
      throw new Error(`Símbolo no admitido: ${node.name}. Usá solamente x.`)
    }
    if (node.type === 'FunctionNode' && (node.fn?.type !== 'SymbolNode' || !safeFunctions.has(node.fn.name ?? ''))) {
      throw new Error('En este modo solo se admiten expresiones polinómicas y constantes.')
    }
  })
  const compiled = ast.compile()
  return x => {
    const value = compiled.evaluate({ x }) as unknown
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15) {
      throw new Error('La ecuación no admite una evaluación numérica válida.')
    }
    return value
  }
}

function equationDifference(source: string): (x: number) => number {
  const text = normalizeEquation(source)
  const pieces = text.split('=')
  if (pieces.length > 2) throw new Error('Escribí una sola igualdad, por ejemplo 2x+3=7.')
  const left = compiledSide(pieces[0])
  const right = compiledSide(pieces.length === 2 ? pieces[1] : '0')
  return x => left(x) - right(x)
}

function coefficients(source: string, maxDegree: 1 | 2): { a: number; b: number; c: number } {
  const f = equationDifference(source)
  const c = f(0)
  const plus = f(1)
  const minus = f(-1)
  const a = maxDegree === 2 ? (plus + minus - 2 * c) / 2 : 0
  const b = maxDegree === 2 ? (plus - minus) / 2 : plus - c
  const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c))
  for (const x of [-3, -2, -0.5, 0.5, 2, 3, Math.SQRT2]) {
    const observed = f(x)
    const expected = a * x * x + b * x + c
    if (Math.abs(observed - expected) > 1e-7 * Math.max(scale, Math.abs(observed), Math.abs(expected))) {
      throw new Error(maxDegree === 1
        ? 'Esta ecuación no es lineal. Usá «Raíces» si tiene x².'
        : 'Este modo resuelve polinomios de primer y segundo grado. No admite ese grado o tipo de ecuación.')
    }
  }
  return { a: Math.abs(a) < EPS * scale ? 0 : a, b: Math.abs(b) < EPS * scale ? 0 : b, c: Math.abs(c) < EPS * scale ? 0 : c }
}

function solveFirstDegree(a: number, b: number, title: string): EquationResult {
  if (a === 0 && b === 0) return {
    title: 'Infinitas soluciones', answers: ['Cualquier número real satisface la igualdad.'], kind: 'identity',
    steps: ['Al simplificar ambos miembros queda 0 = 0.', 'La igualdad se cumple para todos los valores de x.'],
  }
  if (a === 0) return {
    title: 'Sin solución', answers: ['No existe un valor de x que satisfaga la igualdad.'], kind: 'inconsistent',
    steps: [`Al simplificar queda ${displayNumber(b)} = 0.`, 'Es una contradicción.'],
  }
  const x = -b / a
  return {
    title, answers: [`x = ${displayNumber(x)}`], kind: 'linear',
    steps: [`Agrupamos términos: ${displayNumber(a)}x ${b < 0 ? '−' : '+'} ${displayNumber(Math.abs(b))} = 0`,
      `Despejamos: ${displayNumber(a)}x = ${displayNumber(-b)}`,
      `Dividimos entre ${displayNumber(a)}: x = ${displayNumber(-b)} / ${displayNumber(a)}`,
      `Resultado: x = ${displayNumber(x)}`],
  }
}

/** Resuelve ax² + bx + c = 0 o ax + b = 0; admite raíces complejas. */
export function solvePolynomialRoots(source: string): EquationResult {
  const { a, b, c } = coefficients(source, 2)
  if (a === 0) return solveFirstDegree(b, c, 'Raíz de la función')
  const delta = b * b - 4 * a * c
  const steps = [
    `Forma general: (${displayNumber(a)})x² + (${displayNumber(b)})x + (${displayNumber(c)}) = 0`,
    `Discriminante: Δ = b² − 4ac = ${displayNumber(delta)}`,
  ]
  const tolerance = 1e-9 * Math.max(1, Math.abs(b * b), Math.abs(4 * a * c))
  if (delta < -tolerance) {
    const real = -b / (2 * a)
    const imaginary = Math.sqrt(-delta) / Math.abs(2 * a)
    const realPart = displayNumber(real)
    const imaginaryPart = displayNumber(imaginary)
    return {
      title: 'Dos raíces complejas', kind: 'quadratic',
      answers: [`x₁ = ${realPart} + ${imaginaryPart}i`, `x₂ = ${realPart} − ${imaginaryPart}i`],
      steps: [...steps, 'Como Δ < 0, no tiene raíces reales.', 'Aplicamos x = (−b ± √Δ) / 2a utilizando números complejos.'],
    }
  }
  if (Math.abs(delta) <= tolerance) {
    return {
      title: 'Raíz doble', kind: 'quadratic',
      answers: [`x = ${displayNumber(-b / (2 * a))}`],
      steps: [...steps, 'Como Δ = 0, las dos raíces coinciden.', `x = −b / 2a = ${displayNumber(-b / (2 * a))}`],
    }
  }
  const sqrt = Math.sqrt(delta)
  const x1 = (-b + sqrt) / (2 * a)
  const x2 = (-b - sqrt) / (2 * a)
  return {
    title: 'Dos raíces reales', kind: 'quadratic',
    answers: [`x₁ = ${displayNumber(x1)}`, `x₂ = ${displayNumber(x2)}`],
    steps: [...steps, 'Como Δ > 0, hay dos raíces reales distintas.', 'Aplicamos x = (−b ± √Δ) / 2a.',
      `x₁ = ${displayNumber(x1)}; x₂ = ${displayNumber(x2)}`],
  }
}

/** Resuelve ax+b=c; informa cuándo hay infinitas soluciones o ninguna. */
export function solveLinearEquation(source: string): EquationResult {
  const { b, c } = coefficients(source, 1)
  return solveFirstDegree(b, c, 'Solución de la ecuación lineal')
}
