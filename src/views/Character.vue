<script setup lang="ts">
import { ref, watch } from "vue";
import { useBangumi } from "../composables/useBangumi";
import type { CharacterDetail, CharacterPerson } from "../api/bangumi";
import BbcodeSummary from "../components/BbcodeSummary.vue";

const props = defineProps<{
  characterId: number | null;
}>();

const emit = defineEmits<{
  back: [];
  navigatePerson: [personId: number];
}>();

const bangumi = useBangumi();
const loading = ref(false);
const error = ref("");
const detail = ref<CharacterDetail | null>(null);
const relatedPersons = ref<CharacterPerson[]>([]);
const relatedPersonsLoading = ref(false);
const relatedPersonsVisible = ref(6);

function cover(images?: Record<string, string | undefined>) {
  return images?.large || images?.medium || images?.small || images?.grid || "";
}

function subjectTypeLabel(type?: number) {
  switch (type) {
    case 1:
      return "书籍";
    case 2:
      return "动画";
    case 3:
      return "音乐";
    case 4:
      return "游戏";
    case 6:
      return "三次元";
    default:
      return type ? `类型${type}` : "-";
  }
}

function characterTypeLabel(type?: number) {
  if (type === 1) {
    return "角色";
  }

  if (type === 2) {
    return "机体";
  }

  if (type === 3) {
    return "舰船";
  }

  if (type === 4) {
    return "组织";
  }

  return "其他";
}

function birthLabel(character: CharacterDetail) {
  const parts = [character.birth_year, character.birth_mon, character.birth_day].filter((item) => item !== undefined);
  if (parts.length === 0) {
    return "-";
  }

  return parts.join("-");
}

function formatInfoboxValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        const valueItem = item as { k?: unknown; v?: unknown };
        const v = typeof valueItem.v === "string" ? valueItem.v : "";
        const k = typeof valueItem.k === "string" ? valueItem.k : "";

        if (!v) {
          return "";
        }

        return k ? `${k}: ${v}` : v;
      })
      .filter((item) => item.length > 0)
      .join(" / ");
  }

  return String(value ?? "");
}

async function loadCharacterDetail() {
  const characterId = props.characterId ?? 0;
  if (!characterId) {
    detail.value = null;
    error.value = "";
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = "";
  detail.value = null;

  const result = await bangumi.getCharacterDetail(characterId);
  if (!result.ok) {
    error.value = result.error;
    loading.value = false;
    return;
  }

  detail.value = result.data;
  loading.value = false;

  // 加载关联人物
  relatedPersonsLoading.value = true;
  relatedPersons.value = [];
  relatedPersonsVisible.value = 6;
  const personsResult = await bangumi.getCharacterRelatedPersons(characterId);
  if (personsResult.ok) {
    relatedPersons.value = personsResult.data;
  }

  relatedPersonsLoading.value = false;
}

watch(
  () => props.characterId,
  () => {
    void loadCharacterDetail();
  },
  { immediate: true },
);

defineExpose({
  refresh: loadCharacterDetail,
});
</script>

<template>
  <section class="entity-page">
    <section class="entity-page__header">
      <button class="secondary-button" type="button" @click="emit('back')">返回</button>
      <h2>角色详情</h2>
    </section>

    <section v-if="!characterId" class="empty">请先从条目详情选择一个角色。</section>
    <section v-else-if="loading" class="empty">角色详情加载中...</section>
    <section v-else-if="error" class="empty">角色详情加载失败：{{ error }}</section>

    <template v-else-if="detail">
      <article class="detail-section person-hero-panel">
        <div class="person-hero">
          <div class="person-hero__cover">
            <img v-if="cover(detail.images)" :src="cover(detail.images)" alt="" loading="lazy" />
            <span v-else>BG</span>
          </div>
          <div class="person-hero__main">
            <h5>{{ detail.name || `Character #${detail.id}` }}</h5>
            <p class="detail-muted">{{ characterTypeLabel(detail.type) }}</p>
          </div>
        </div>
        <BbcodeSummary :content="detail.summary" />
      </article>

      <article class="detail-section">
        <h4>基础信息</h4>
        <dl class="detail-grid">
          <div><dt>ID</dt><dd>{{ detail.id }}</dd></div>
          <div><dt>类型</dt><dd>{{ characterTypeLabel(detail.type) }}</dd></div>
          <div><dt>性别</dt><dd>{{ detail.gender || "-" }}</dd></div>
          <div><dt>生日</dt><dd>{{ birthLabel(detail) }}</dd></div>
          <div><dt>收藏数</dt><dd>{{ detail.stat.collects }}</dd></div>
          <div><dt>评论数</dt><dd>{{ detail.stat.comments }}</dd></div>
          <div><dt>锁定</dt><dd>{{ detail.locked ? "是" : "否" }}</dd></div>
        </dl>
      </article>

      <article class="detail-section">
        <h4>关联人物</h4>
        <section v-if="relatedPersonsLoading" class="empty">加载中...</section>
        <section v-else-if="relatedPersons.length === 0" class="empty">暂无关联人物</section>
        <template v-else>
          <ul class="related-person-list">
            <li
              v-for="item in relatedPersons.slice(0, relatedPersonsVisible)"
              :key="`${item.id}-${item.subject_id}`"
              class="related-person-card related-person-card--button"
              role="button"
              tabindex="0"
              @click="emit('navigatePerson', item.id)"
              @keydown.enter.prevent="emit('navigatePerson', item.id)"
              @keydown.space.prevent="emit('navigatePerson', item.id)"
            >
              <img
                v-if="cover(item.images)"
                :src="cover(item.images)"
                alt=""
                loading="lazy"
                class="related-person-card__avatar"
              />
              <span v-else class="related-person-card__avatar related-person-card__avatar--placeholder">BG</span>
              <div class="related-person-card__info">
                <span class="related-person-card__name">{{ item.name }}</span>
                <span class="related-person-card__staff" v-if="item.staff">{{ item.staff }}</span>
                <span class="related-person-card__subject">
                  {{ item.subject_name_cn || item.subject_name }}
                  <span class="tag-chip tag-chip--meta">{{ subjectTypeLabel(item.subject_type) }}</span>
                </span>
              </div>
            </li>
          </ul>
          <button
            v-if="relatedPersonsVisible < relatedPersons.length"
            class="secondary-button"
            type="button"
            style="margin-top:8px;width:100%"
            @click="relatedPersonsVisible += 6"
          >
            加载更多（剩余 {{ relatedPersons.length - relatedPersonsVisible }} 名）
          </button>
        </template>
      </article>

      <article v-if="detail.infobox?.length" class="detail-section infobox">
        <h4>Infobox</h4>
        <dl>
          <div v-for="item in detail.infobox" :key="item.key">
            <dt>{{ item.key }}</dt>
            <dd>{{ formatInfoboxValue(item.value) }}</dd>
          </div>
        </dl>
      </article>
    </template>
  </section>
</template>
