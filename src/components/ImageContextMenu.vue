<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

const emit = defineEmits<{
  saved: [message: string];
  error: [message: string];
}>();

const visible = ref(false);
const saving = ref(false);
const imageUrl = ref("");
const position = ref({ x: 0, y: 0 });
const menuRef = ref<HTMLElement | null>(null);

const menuStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}));

function imageFromEvent(event: MouseEvent | DragEvent): HTMLImageElement | null {
  for (const item of event.composedPath()) {
    if (item instanceof HTMLImageElement) return item;
  }
  return event.target instanceof Element ? event.target.closest("img") : null;
}

function closeMenu() {
  if (!saving.value) visible.value = false;
}

function placeMenu(clientX: number, clientY: number) {
  position.value = { x: clientX, y: clientY };
  requestAnimationFrame(() => {
    const menu = menuRef.value;
    if (!menu) return;
    const padding = 10;
    position.value = {
      x: Math.max(padding, Math.min(clientX, window.innerWidth - menu.offsetWidth - padding)),
      y: Math.max(padding, Math.min(clientY, window.innerHeight - menu.offsetHeight - padding)),
    };
  });
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  const image = imageFromEvent(event);
  const source = image?.currentSrc || image?.src || "";
  if (!source) {
    closeMenu();
    return;
  }

  imageUrl.value = source;
  visible.value = true;
  placeMenu(event.clientX, event.clientY);
}

function handleDragStart(event: DragEvent) {
  if (imageFromEvent(event)) event.preventDefault();
}

function suggestedFilename(source: string) {
  try {
    const pathname = new URL(source).pathname;
    const lastPart = decodeURIComponent(pathname.split("/").pop() || "");
    const safeName = lastPart.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    if (/\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(safeName)) return safeName;
  } catch { /* Use the generic filename below. */ }
  return "SimpBangumi-image.png";
}

function fileExtension(filename: string) {
  return filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "png";
}

async function saveImage() {
  if (saving.value || !imageUrl.value) return;
  const filename = suggestedFilename(imageUrl.value);
  const destination = await save({
    title: "图片另存为",
    defaultPath: filename,
    filters: [{ name: "图片", extensions: [fileExtension(filename)] }],
  });
  if (!destination) {
    visible.value = false;
    return;
  }

  saving.value = true;
  try {
    const source = new URL(imageUrl.value, window.location.href);
    const isRemote = /^https?:$/.test(source.protocol) && !["asset.localhost", "tauri.localhost", window.location.hostname].includes(source.hostname);
    if (isRemote) {
      await invoke("save_image_to_path", { url: source.href, path: destination });
    } else {
      const response = await fetch(source.href);
      if (!response.ok) throw new Error(`无法读取图片（HTTP ${response.status}）`);
      const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
      await invoke("save_image_bytes_to_path", { bytes, path: destination });
    }
    visible.value = false;
    emit("saved", "图片已保存");
  } catch (error) {
    emit("error", `保存图片失败：${String(error)}`);
  } finally {
    saving.value = false;
  }
}

function handlePointerDown(event: PointerEvent) {
  if (!visible.value || menuRef.value?.contains(event.target as Node)) return;
  closeMenu();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeMenu();
}

onMounted(() => {
  document.addEventListener("contextmenu", handleContextMenu);
  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
  document.addEventListener("scroll", closeMenu, true);
});

onUnmounted(() => {
  document.removeEventListener("contextmenu", handleContextMenu);
  document.removeEventListener("dragstart", handleDragStart);
  document.removeEventListener("pointerdown", handlePointerDown);
  document.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("blur", closeMenu);
  window.removeEventListener("resize", closeMenu);
  document.removeEventListener("scroll", closeMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="image-menu-pop">
      <div
        v-if="visible"
        ref="menuRef"
        class="image-context-menu"
        :style="menuStyle"
        role="menu"
        aria-label="图片操作"
        @contextmenu.stop.prevent
      >
        <button type="button" role="menuitem" :disabled="saving" @click="saveImage">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
          </svg>
          <span>{{ saving ? "正在保存…" : "图片另存为" }}</span>
          <span v-if="saving" class="image-context-menu__spinner" aria-hidden="true"></span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
