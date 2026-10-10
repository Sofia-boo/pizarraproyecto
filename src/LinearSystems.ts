/** Sistemas cuadrados 2x2 y 3x3 mediante eliminación de Gauss-Jordan con pivoteo parcial. */
export type LinearSystemResult = {
  title: string
  answers: string[]
  kind: 'unique' | 'infinite' | 'inconsistent'
}

export type LinearSystemInput = {
  dimension: 2 | 3
  /** Cada fila conserva [coeficiente x, coeficiente y, coeficiente z, término independiente]. */
  cells: string[][]
}

export function formatSystemNumber(value: number): string {
  if (Math.abs(value) < 1e-10) return '0'
  return String(Number(value.toPrecision(10)))
}

function parseNumber(raw: string): number {
  const text = raw.trim().replace(',', '.')
  if (!text) return 0
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    throw new Error(`Coeficiente inválido: «${raw}». Ingresá un número.`)
  }
  const value = Number(text)
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) {
    throw new Error('Hay un coeficiente demasiado grande o no válido.')
  }
  return value
}

export function solveLinearSystem({ dimension, cells }: LinearSystemInput): LinearSystemResult {
  if (dimension !== 2 && dimension !== 3) throw new Error('Elegí un sistema de 2 o 3 incógnitas.')
  const n = dimension
  const used = cells.slice(0, n)
  if (used.length < n) throw new Error(`El sistema necesita ${n} ecuaciones.`)
  if (!used.some(row => [...row.slice(0, n), row[3]].some(value => value.trim()))) {
    throw new Error('Ingresá los coeficientes del sistema.')
  }
  const matrix = used.map(row => [...Array.from({ length: n }, (_, c) => parseNumber(row[c] ?? '')), parseNumber(row[3] ?? '')])
  const original = matrix.map(row => [...row])
  const matrixMax = Math.max(...matrix.flatMap(row => row.slice(0, n).map(Math.abs)), 0)
  const rhsMax = Math.max(...matrix.map(row => Math.abs(row[n])), 0)
  const epsilon = 1e-10 * Math.max(1, matrixMax)
  let pivotRow = 0
  const pivots: number[] = []

  for (let col = 0; col < n && pivotRow < n; col++) {
    let best = pivotRow
    for (let row = pivotRow + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[best][col])) best = row
    }
    if (Math.abs(matrix[best][col]) <= epsilon) continue
    ;[matrix[pivotRow], matrix[best]] = [matrix[best], matrix[pivotRow]]
    const pivot = matrix[pivotRow][col]
    for (let k = col; k <= n; k++) matrix[pivotRow][k] /= pivot
    for (let row = 0; row < n; row++) {
      if (row === pivotRow) continue
      const factor = matrix[row][col]
      for (let k = col; k <= n; k++) matrix[row][k] -= factor * matrix[pivotRow][k]
    }
    pivots.push(col)
    pivotRow++
  }

  const rhsTolerance = 1e-8 * Math.max(1, rhsMax)
  for (const row of matrix) {
    if (row.slice(0, n).every(value => Math.abs(value) <= epsilon) && Math.abs(row[n]) > rhsTolerance) {
      return { title: 'Sistema sin solución', answers: ['Las ecuaciones son incompatibles.'], kind: 'inconsistent' }
    }
  }
  if (pivots.length < n) {
    return { title: 'Infinitas soluciones', answers: ['El sistema tiene variables libres.'], kind: 'infinite' }
  }
  const values = Array(n).fill(0) as number[]
  pivots.forEach((col, row) => { values[col] = matrix[row][n] })
  if (!values.every(Number.isFinite)) throw new Error('El sistema no admite una solución numérica estable.')
  const residualScale = Math.max(1, matrixMax * Math.max(...values.map(Math.abs)), rhsMax)
  if (original.some(row => Math.abs(row.slice(0, n).reduce((sum, coef, col) => sum + coef * values[col], 0) - row[n]) > 1e-7 * residualScale)) {
    throw new Error('La matriz está mal condicionada. Revisá los coeficientes.')
  }
  return {
    title: 'Solución del sistema',
    answers: ['x', 'y', 'z'].slice(0, n).map((variable, index) => `${variable} = ${formatSystemNumber(values[index])}`),
    kind: 'unique',
  }
}

/** Lee sistemas manuscritos transcritos, por ejemplo "2x+y=5\nx-y=1". */
export function parseLinearSystemText(source: string): LinearSystemInput {
  const equations = source.replace(/[−–]/g, '-').replace(/×/g, '*')
    .split(/[;\n]+/).map(line => line.trim()).filter(Boolean)
  if (equations.length !== 2 && equations.length !== 3) {
    throw new Error('Seleccioná dos o tres ecuaciones, una por renglón, para cargar el sistema.')
  }
  const dimension = equations.length as 2 | 3
  const cells = Array.from({ length: 3 }, () => ['', '', '', ''])
  for (let r = 0; r < dimension; r++) {
    const pieces = equations[r].split('=')
    if (pieces.length !== 2) throw new Error(`La ecuación ${r + 1} debe contener un signo igual.`)
    const left = parseLinearSide(pieces[0])
    const right = parseLinearSide(pieces[1])
    const coeffs = left.coeffs.map((value, index) => value - right.coeffs[index])
    if (dimension === 2 && Math.abs(coeffs[2]) > 1e-12) {
      throw new Error('Para usar la variable z, seleccioná tres ecuaciones.')
    }
    for (let c = 0; c < dimension; c++) cells[r][c] = formatSystemNumber(coeffs[c])
    cells[r][3] = formatSystemNumber(right.constant - left.constant)
  }
  return { dimension, cells }
}

function parseLinearSide(source: string): { coeffs: number[]; constant: number } {
  const compact = source.replace(/\s+/g, '').replace(/(\d),(\d)/g, '$1.$2')
  if (!compact) throw new Error('Hay un miembro vacío en una ecuación.')
  const parts = compact.replace(/-/g, '+-').split('+').filter(Boolean)
  const coeffs = [0, 0, 0]
  let constant = 0
  for (const term of parts) {
    const sign = term.startsWith('-') ? -1 : 1
    const unsigned = sign < 0 ? term.slice(1) : term
    const match = unsigned.match(/^((?:(?:\d+(?:\.\d*)?|\.\d+)(?:\/(?:\d+(?:\.\d*)?|\.\d+))?)\*?)?([xyz])$/i)
    if (match) {
      const variableIndex = 'xyz'.indexOf(match[2].toLowerCase())
      const coefficient = match[1] ? fractionNumber(match[1].replace(/\*$/, '')) : 1
      coeffs[variableIndex] += sign * coefficient
    } else if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:\/(?:\d+(?:\.\d*)?|\.\d+))?$/.test(unsigned)) {
      constant += sign * fractionNumber(unsigned)
    } else {
      throw new Error(`No pude interpretar «${term}». Usá términos como 2x, -3y o 5.`)
    }
  }
  return { coeffs, constant }
}

function fractionNumber(text: string): number {
  const parts = text.split('/')
  const numerator = Number(parts[0])
  const denominator = parts.length > 1 ? Number(parts[1]) : 1
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
    throw new Error('Hay una fracción no válida.')
  }
  const value = numerator / denominator
  if (Math.abs(value) > 1e12) throw new Error('Un coeficiente es demasiado grande.')
  return value
}
