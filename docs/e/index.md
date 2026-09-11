---
outline: false
---

<script setup lang="ts">
import { withBase } from 'vitepress';
import { data as codes } from './codes.data';

const families = [...new Set(codes.map((c) => c.family))];
</script>

# Error codes

Every error Volt throws carries a code. A development build prints the full
sentence with it; a production build leaves the sentence out and keeps the code,
what failed, and a link here:

```
[volt] V0212 target=#app https://voltjs.dev/e/V0212
```

So a report from production is one click from the explanation a development
build would have printed. How an error is shaped — `code`, `detail`, `docs` — is
under [Errors](/reference/component#errors).

The codes are numbered by family, a hundred to each, and a code is never reused
for a second failure. The pages are generated from the framework's source when
this site is built, so a message reworded in the source is reworded here.

**Development only** marks a check a production build does not make — an
authoring mistake caught while the program is written. Those codes never appear
in a production error.

<template v-for="family in families" :key="family">
  <h2 :id="family.toLowerCase().replace(/\W+/g, '-')">{{ family }}</h2>
  <table>
    <thead>
      <tr><th>Code</th><th>What it says</th><th></th></tr>
    </thead>
    <tbody>
      <tr v-for="c in codes.filter((c) => c.family === family)" :key="c.code">
        <td><a :href="withBase(`/e/${c.code}`)">{{ c.code }}</a></td>
        <td>{{ c.summary }}</td>
        <td>{{ c.inProduction ? '' : 'Development only' }}</td>
      </tr>
    </tbody>
  </table>
</template>
