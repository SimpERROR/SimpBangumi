<script setup lang="ts">
import cfLogo from "../assets/cf/CF-Logo 1.png";
</script>

<template>
  <Teleport to="body">
    <Transition name="workers-modal">
      <div class="workers-overlay">
        <div class="workers-modal">
          <img
            :src="cfLogo"
            alt="Cloudflare"
            class="workers-modal__logo"
          />
          <p class="workers-modal__text">正在与 Workers 通信以完成登录。</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.workers-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.workers-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
}

.workers-modal__logo {
  width: 96px;
  height: 96px;
  object-fit: contain;
  animation: cf-bounce 1.2s ease-in-out infinite;
  background: #ffffff;
  border-radius: 24px;
  padding: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
}

.workers-modal__text {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
  letter-spacing: 0.02em;
}

@keyframes cf-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-18px);
  }
  60% {
    transform: translateY(-6px);
  }
  80% {
    transform: translateY(-3px);
  }
}

.workers-modal-enter-active {
  transition: opacity 280ms ease;
}

.workers-modal-leave-active {
  transition: opacity 220ms ease;
}

.workers-modal-enter-from,
.workers-modal-leave-to {
  opacity: 0;
}
</style>
