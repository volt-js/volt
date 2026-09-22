<script setup lang="ts">
/**
 * A live demo: the component running in a frame, sized to what it draws.
 *
 * The source is loaded only on the client, so a page renders on the server
 * with an empty frame of the right height rather than with a guess at the
 * theme. The frame follows the documentation's light and dark switch by
 * message rather than by reloading, so switching does not throw away what the
 * reader had open.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';

const props = defineProps<{
  /** The directory under `docs/demos/`. */
  name: string;
  /** Room for what the demo opens beyond its own box, such as a menu. In pixels. */
  height?: number | string;
}>();

const { isDark } = useData();
const frame = ref<HTMLIFrameElement | null>(null);
const src = ref('');
const measured = ref(0);

const minimum = computed(() => Number(props.height ?? 0));
const shown = computed(() => Math.max(measured.value, minimum.value, 64));

function onMessage(event: MessageEvent): void {
  if (event.source !== frame.value?.contentWindow) return;
  const data = event.data as { type?: string; height?: number } | null;
  if (data?.type === 'volt-demo-size' && typeof data.height === 'number') {
    measured.value = data.height;
  }
}

function sendTheme(): void {
  frame.value?.contentWindow?.postMessage(
    { type: 'volt-demo-theme', theme: isDark.value ? 'dark' : 'light' },
    '*',
  );
}

onMounted(() => {
  window.addEventListener('message', onMessage);
  const theme = isDark.value ? 'dark' : 'light';
  src.value = withBase(`/demos/?d=${encodeURIComponent(props.name)}&theme=${theme}`);
});
onBeforeUnmount(() => window.removeEventListener('message', onMessage));
watch(isDark, sendTheme);
</script>

<template>
  <div class="volt-demo">
    <iframe
      ref="frame"
      :src="src || undefined"
      :title="`Live demo: ${name}`"
      :style="{ height: `${shown}px` }"
      loading="lazy"
    ></iframe>
  </div>
</template>

<style scoped>
.volt-demo {
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}

iframe {
  display: block;
  width: 100%;
  border: 0;
  /* The demo page paints its own ground; this is what shows before it loads. */
  background: var(--vp-c-bg-soft);
}
</style>
