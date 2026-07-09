<script setup lang="ts">
import { computed } from "vue";
import {
  linkModalVisible,
  pendingUrl,
  cancelOpenLink,
  confirmOpenLink,
  skipDomainAndOpen,
} from "../composables/useLinkInterceptor";

const domain = computed(() => {
  try {
    return new URL(pendingUrl.value).hostname;
  } catch {
    return "";
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="link-confirm">
      <div v-if="linkModalVisible" class="overlay link-confirm-overlay" @click.self="cancelOpenLink">
        <div class="modal link-confirm-modal">
          <h3>打开外部链接</h3>
          <p class="link-confirm-modal__url">{{ pendingUrl }}</p>
          <p>即将在系统浏览器中打开以上链接，是否继续？</p>
          <div class="modal__actions">
            <button class="secondary-button" type="button" @click="cancelOpenLink">取消</button>
            <button class="primary-button" type="button" @click="confirmOpenLink">在浏览器中打开</button>
          </div>
          <div v-if="domain" class="modal__actions" style="margin-top: 8px;">
            <button class="secondary-button" type="button" @click="skipDomainAndOpen">
              对 {{ domain }} 不再提示
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

