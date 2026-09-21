// Test-only bundle: keep real client role labels; never load server auth in a fixture.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
await build({ entryPoints:['tests/ui/entry-harness.tsx'], bundle:true, conditions:['style','browser'], external:['/fonts/*'], format:'esm', jsx:'automatic', outfile:'tests/ui/generated/entry-harness.js', define:{'process.env.NODE_ENV':'"development"'}, plugins:[{
  name:'client-role-labels-only', setup(bundler) {
    bundler.onLoad({filter:/[/\\]lib[/\\]access-control\.ts$/}, async ({path}) => {
      const source=await readFile(path,'utf8');
      const label=source.match(/export const roleLabel = [\s\S]*?;\n/);
      if (!label) throw new Error('No se encontró el helper real de etiquetas');
      return {contents:label[0],loader:'ts'};
    });
  }
}]});
