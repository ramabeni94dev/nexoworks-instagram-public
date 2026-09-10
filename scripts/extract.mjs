import { parseArgs } from 'node:util';
import { extractProfile } from '../lib/extract.mjs';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { limit: { type: 'string', default: '12' }, output: { type: 'string', default: './artifacts/extractions' } },
  });
  if (positionals.length !== 1) throw new Error('Uso: npm run extract -- @usuario [--limit 12] [--output carpeta]');
  const result = await extractProfile(positionals[0], { limit: values.limit, outputDirectory: values.output });
  console.log(JSON.stringify({ status: result.status, username: result.username, posts: result.extractedPosts, imagesSaved: result.imagesSaved, missedImages: result.missedImages, directory: result.directory, error: result.error }, null, 2));
  if (result.status !== 'SUCCEEDED') process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
