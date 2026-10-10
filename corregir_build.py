r"""Corrige los nueve errores TS mostrados por `npm.cmd run build`.

Ejecutar desde la carpeta del proyecto:
    .\.venv\Scripts\python.exe .\corregir_build.py

No desactiva TypeScript, no cambia logica de pizarra ni datos. Hace copias
antes de escribir y comprueba los patrones ANTES de tocar cualquier archivo.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'


def replace_once(source: str, pattern: str, replacement: str, description: str, flags: int = 0) -> str:
    result, count = re.subn(pattern, lambda match: match.expand(replacement), source, flags=flags)
    if count != 1:
        raise ValueError(f'{description}: se esperaba 1 coincidencia, encontradas {count}.')
    return result


def run() -> int:
    targets = {
        'App.tsx': SRC / 'App.tsx',
        'GraphFeatures.ts': SRC / 'GraphFeatures.ts',
        'GraphPlot.tsx': SRC / 'GraphPlot.tsx',
        'RightMathDock.tsx': SRC / 'RightMathDock.tsx',
    }
    missing = [str(path) for path in targets.values() if not path.is_file()]
    if missing:
        print('No se encontraron estos archivos:')
        print('\n'.join(f'  {x}' for x in missing))
        print('Ubicá este script junto a package.json (en la raíz del proyecto).')
        return 1

    originals = {name: path.read_text(encoding='utf-8') for name, path in targets.items()}
    updated = dict(originals)
    try:
        # Eliminamos una función que quedó de la antigua exportación PNG. Actualmente
        # ningún componente la utiliza: los gráficos se insertan como objetos vivos.
        updated['App.tsx'] = replace_once(
            updated['App.tsx'],
            r'^[ \t]*async function addImageFromDataUrl\(dataUrl: string, name = [\'\"]grafico\.png[\'\"]\)\s*\{\s*'
            r'const response = await fetch\(dataUrl\)\s*'
            r'const blob = await response\.blob\(\)\s*'
            r'const file = new File\(\[blob\], name, \{ type: blob\.type \|\| [\'\"]image/png[\'\"] \}\)\s*'
            r'await addImage\(file\)\s*\}\s*\n',
            '',
            'App.tsx: eliminar función de exportación antigua',
            re.MULTILINE,
        )
        updated['App.tsx'] = replace_once(
            updated['App.tsx'],
            r'^[ \t]*const monthPrefix\s*=\s*`\$\{calendarYear\}-\$\{String\(calendarMonthIndex\+1\)\.padStart\(2,[\'\"]0[\'\"]\)\}`;?[ \t]*\n',
            '',
            'App.tsx: eliminar mes no utilizado',
            re.MULTILINE,
        )

        # `ReturnType<typeof math.compile>` corresponde a la sobrecarga que acepta
        # un arreglo y puede inferirse como EvalFunction[]. Para una función
        # compilada única necesitamos EvalFunction.
        graph = updated['GraphFeatures.ts']
        if "import type { EvalFunction } from 'mathjs'" not in graph:
            graph = replace_once(
                graph,
                r"^import \{ create, all \} from 'mathjs'\s*\n",
                "import { create, all } from 'mathjs'\nimport type { EvalFunction } from 'mathjs'\n",
                'GraphFeatures.ts: importar tipo EvalFunction',
                re.MULTILINE,
            )
        occurrences = graph.count('ReturnType<typeof math.compile>')
        if occurrences != 2:
            raise ValueError(f'GraphFeatures.ts: se esperaban 2 usos del tipo erróneo, hay {occurrences}.')
        graph = graph.replace('ReturnType<typeof math.compile>', 'EvalFunction')
        updated['GraphFeatures.ts'] = graph

        dock = updated['RightMathDock.tsx']
        dock = replace_once(
            dock,
            r'(function\s+compileSafe\s*\(source\s*:\s*string\s*\))\s*:\s*ReturnType<typeof math\.compile>',
            r'\g<1>',
            'RightMathDock.tsx: inferir tipo correcto de compileSafe',
        )
        updated['RightMathDock.tsx'] = dock

        plot = updated['GraphPlot.tsx']
        plot = replace_once(plot, r'\bFiX, FiCheck\b', 'FiX', 'GraphPlot.tsx: quitar FiCheck')
        plot = replace_once(plot, r'\bGraphFeatures, GraphPoint, Curve\b', 'GraphFeatures, Curve', 'GraphPlot.tsx: quitar GraphPoint')
        updated['GraphPlot.tsx'] = plot

        # No borrar ni editar ningún archivo si algún patrón anterior falla.
        unchanged = [name for name in targets if originals[name] == updated[name]]
        if unchanged:
            raise ValueError('No hubo cambios en: ' + ', '.join(unchanged))
    except ValueError as exc:
        print('NO SE MODIFICÓ NINGÚN ARCHIVO.')
        print('Motivo:', exc)
        print('La versión de tu código puede ser distinta. Adjuntá esos archivos para adaptar la corrección.')
        return 2

    backup_dir = ROOT / 'copias_antes_fix_build' / datetime.now().strftime('%Y%m%d-%H%M%S')
    for name, path in targets.items():
        destination = backup_dir / 'src' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)

    for name, path in targets.items():
        path.write_text(updated[name], encoding='utf-8')
        print('Corregido:', path.relative_to(ROOT))

    print('\nCopias de seguridad:', backup_dir)
    print('Siguiente paso: npm.cmd run build')
    return 0


if __name__ == '__main__':
    sys.exit(run())
