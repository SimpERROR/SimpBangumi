<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import Pager from "../components/Pager.vue";
import BbcodeSummary from "../components/BbcodeSummary.vue";
import { useAppStore } from "../stores/app";
import { useDataStore } from "../stores/data";
import { useBangumi } from "../composables/useBangumi";
import { isFollowed } from "../composables/useBroadcastNotify";
import { useSessionStore } from "../stores/session";
import type {
  BangumiIndex,
  IndexSubject,
  SearchCharacter,
  SearchPerson,
  SearchSubject,
  UserCharacterCollection,
  UserPersonCollection,
} from "../api/bangumi";

type LibraryTab = "character" | "person" | "index";
type IndexListMode = "created" | "collected";
type IndexDetailMode = "browse" | "edit";
type IndexSearchType = "all" | "anime" | "book" | "game" | "music" | "real" | "person" | "character";

interface IndexSearchResult {
  id: number;
  kind: "subject" | "person" | "character";
  title: string;
  subtitle: string;
  meta: string;
  images?: Record<string, string | undefined>;
  subject?: SearchSubject;
}

const props = withDefaults(defineProps<{
  activeTab?: LibraryTab;
  showTabs?: boolean;
}>(), {
  activeTab: "character",
  showTabs: true,
});

interface WebIndexSummary {
  id: number;
  title: string;
  description: string;
  total: number;
}
const emit = defineEmits<{
  openSubject: [subjectId: number];
  openCharacter: [characterId: number];
  openPerson: [personId: number];
}>();

const RECENT_INDICES_KEY = "bangumi.indices.recent";
const INDEX_PAGE_SIZE = 20;
const bangumi = useBangumi();
const appStore = useAppStore();
const dataStore = useDataStore();
const sessionStore = useSessionStore();
const activeTab = ref<LibraryTab>(props.activeTab);
const loading = ref(false);
const error = ref("");
const characters = ref<UserCharacterCollection[]>([]);
const persons = ref<UserPersonCollection[]>([]);
let monoLoadVersion = 0;
let indexLoadVersion = 0;

const indexIdInput = ref("");
const indexDrawerOpen = ref(false);
const indexSuspendedForSubject = ref(false);
const suspendedIndexScrollTop = ref(0);
const indexDetailMode = ref<IndexDetailMode>("browse");
const indexDetailContentRef = ref<HTMLElement | null>(null);
const indexListTabsRef = ref<HTMLElement | null>(null);
const indexCreatedTabRef = ref<HTMLElement | null>(null);
const indexCollectedTabRef = ref<HTMLElement | null>(null);
const createIndexTitleRef = ref<HTMLInputElement | null>(null);
const indexDetailModeRef = ref<HTMLElement | null>(null);
const indexBrowseTabRef = ref<HTMLElement | null>(null);
const indexEditTabRef = ref<HTMLElement | null>(null);
const indexListIndicatorStyle = ref({ left: "4px", width: "0px" });
const indexDetailIndicatorStyle = ref({ left: "3px", width: "0px" });
const showIndexBackToTop = ref(false);
const indexLoading = ref(false);
const indexLoadingProgress = ref(0);
const indexLoadingMessage = ref("正在准备目录...");
const indexTypeEnrichmentSkipped = ref(false);
const indexTypeEnrichmentVersion = ref(0);
const indexError = ref("");
const indexDetail = ref<BangumiIndex | null>(null);
const indexCanAddRelated = ref(false);
const indexCollected = ref(false);
const indexCollectionLoading = ref(false);
const indexCollectionSaving = ref(false);
const allIndexSubjects = ref<IndexSubject[]>([]);
const indexSubjects = ref<IndexSubject[]>([]);
const indexCategoryFilter = ref<IndexSearchType>("all");
const indexOffset = ref(0);
const indexTotal = ref(0);
const recentIndexIds = ref<number[]>([]);
const indexListMode = ref<IndexListMode>("created");
const webIndices = ref<WebIndexSummary[]>([]);
const webIndicesLoading = ref(false);
const webIndicesError = ref("");
const webIndexPage = ref(1);
const webIndexHasNext = ref(false);
const createIndexDialogOpen = ref(false);
const createForm = reactive({ title: "", description: "", submitting: false });
const editForm = reactive({ title: "", description: "", submitting: false });
const deleteIndexDialogOpen = ref(false);
const deleteIndexSubmitting = ref(false);
const deleteIndexError = ref("");
const addForm = reactive({ subjectId: "", sort: "", comment: "", submitting: false, error: "" });
const subjectSearchType = ref<IndexSearchType>("all");
const subjectSearchQuery = ref("");
const subjectSearchResults = ref<IndexSearchResult[]>([]);
const subjectSearchLoading = ref(false);
const subjectSearchError = ref("");
const subjectSearchOpen = ref(false);
const subjectSearchActiveIndex = ref(-1);
const selectedSearchSubject = ref<SearchSubject | null>(null);
const editingSubjectId = ref<number | null>(null);
const subjectEditForm = reactive({ sort: "", comment: "", submitting: false });
let subjectSearchTimer: ReturnType<typeof setTimeout> | null = null;
let subjectSearchBlurTimer: ReturnType<typeof setTimeout> | null = null;
let subjectSearchVersion = 0;

const authenticated = computed(() => sessionStore.authenticated.value);
const currentUsername = computed(() => sessionStore.session.value?.user?.username ?? "");
const canEditIndex = computed(() => Boolean(
  authenticated.value
  && indexDetail.value
  && currentUsername.value
  && indexDetail.value.creator.username === currentUsername.value,
));
const indexPage = computed(() => Math.floor(indexOffset.value / INDEX_PAGE_SIZE) + 1);
const indexLastPage = computed(() => indexOffset.value + INDEX_PAGE_SIZE >= indexTotal.value);
const indexCategoryTabs: Array<{ key: IndexSearchType; label: string }> = [
  { key: "all", label: "全部" },
  { key: "anime", label: "动画" },
  { key: "book", label: "书籍" },
  { key: "game", label: "游戏" },
  { key: "music", label: "音乐" },
  { key: "real", label: "三次元" },
  { key: "person", label: "人物" },
  { key: "character", label: "角色" },
];

const indexCategoryCounts = computed<Record<IndexSearchType, number>>(() => {
  const counts: Record<IndexSearchType, number> = {
    all: allIndexSubjects.value.length,
    anime: 0,
    book: 0,
    game: 0,
    music: 0,
    real: 0,
    person: 0,
    character: 0,
  };
  for (const subject of allIndexSubjects.value) {
    if (subject.kind === "person") counts.person += 1;
    else if (subject.kind === "character") counts.character += 1;
    else if (subject.kind === "subject") {
      const category = (Object.entries({ anime: 2, book: 1, game: 4, music: 3, real: 6 }) as Array<[IndexSearchType, number]>).find(([, type]) => type === subject.type)?.[0];
      if (category) counts[category] += 1;
    }
  }
  return counts;
});
const filteredIndexSubjects = computed(() => {
  const filter = indexCategoryFilter.value;
  if (filter === "all") return allIndexSubjects.value;
  if (filter === "person" || filter === "character") {
    return allIndexSubjects.value.filter((subject) => subject.kind === filter);
  }
  const type = subjectTypeFilter(filter)?.[0];
  return allIndexSubjects.value.filter((subject) => subject.kind === "subject" && subject.type === type);
});

function refreshIndexSubjectPage() {
  indexTotal.value = filteredIndexSubjects.value.length;
  indexSubjects.value = filteredIndexSubjects.value.slice(indexOffset.value, indexOffset.value + INDEX_PAGE_SIZE);
}

function setIndexCategoryFilter(filter: IndexSearchType) {
  indexCategoryFilter.value = filter;
  indexOffset.value = 0;
  refreshIndexSubjectPage();
}
function cover(images?: Record<string, string | undefined>) {
  return images?.grid || images?.small || images?.medium || images?.large || "";
}

function subjectCollectionType(id: number): number {
  return dataStore.subjectCollectionMap[id] ?? 0;
}

function subjectTypeLabel(type: number) {
  return ({ 1: "书籍", 2: "动画", 3: "音乐", 4: "游戏", 6: "三次元" } as Record<number, string>)[type] || "条目";
}

function indexItemTypeLabel(subject: IndexSubject) {
  return ({
    subject: subjectTypeLabel(subject.type),
    character: "角色",
    person: "人物",
    episode: "章节",
    blog: "日志",
    group_topic: "小组话题",
    subject_topic: "条目话题",
  } as Record<string, string>)[subject.kind || "subject"] || "关联";
}

const subjectSearchTypeLabels: Record<IndexSearchType, string> = {
  all: "全部",
  anime: "动画",
  book: "书籍",
  game: "游戏",
  music: "音乐",
  real: "三次元",
  person: "人物",
  character: "角色",
};

function subjectTypeFilter(type: IndexSearchType): number[] | undefined {
  return ({ anime: [2], book: [1], game: [4], music: [3], real: [6] } as Partial<Record<IndexSearchType, number[]>>)[type];
}

function loadRecentIndices() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_INDICES_KEY) || "[]");
    if (Array.isArray(parsed)) {
      recentIndexIds.value = parsed.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 8);
    }
  } catch {
    recentIndexIds.value = [];
  }
}

function rememberIndex(id: number) {
  recentIndexIds.value = [id, ...recentIndexIds.value.filter((item) => item !== id)].slice(0, 8);
  localStorage.setItem(RECENT_INDICES_KEY, JSON.stringify(recentIndexIds.value));
}

async function loadMonoCollections() {
  const tab = activeTab.value;
  if (!authenticated.value || tab === "index") return;
  if (!currentUsername.value) {
    error.value = "无法读取当前用户信息，请重新登录后重试。";
    return;
  }
  const loadVersion = ++monoLoadVersion;
  loading.value = true;
  error.value = "";
  const result = tab === "character"
    ? await bangumi.getUserCharacterCollections(currentUsername.value)
    : await bangumi.getUserPersonCollections(currentUsername.value);
  if (loadVersion !== monoLoadVersion) return;

  if (result.ok && result.data.data.length > 0) {
    if (tab === "character") characters.value = result.data.data as UserCharacterCollection[];
    else persons.value = result.data.data as UserPersonCollection[];
    loading.value = false;
    return;
  }

  const fallback = await bangumi.fetchUserMonoCollectionsPage(currentUsername.value, tab);
  if (loadVersion !== monoLoadVersion) return;
  if (!fallback.ok) {
    error.value = result.ok ? fallback.error : `${result.error}；网页回退失败：${fallback.error}`;
  } else {
    const parsed = parseUserMonoCollectionsPage(fallback.data, tab);
    if (tab === "character") characters.value = parsed as UserCharacterCollection[];
    else persons.value = parsed as UserPersonCollection[];
    if (parsed.length === 0 && !result.ok) error.value = result.error;
  }
  loading.value = false;
}

function switchTab(tab: LibraryTab) {
  activeTab.value = tab;
}

function absoluteWebUrl(url: string) {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://bangumi.tv${url}`;
  return url;
}

function imageFromElement(element: Element) {
  const image = element.querySelector<HTMLImageElement>("img");
  const source = image?.getAttribute("src") || image?.getAttribute("data-src") || "";
  if (source) return absoluteWebUrl(source);
  const styled = element.querySelector<HTMLElement>('[style*="url("]');
  const match = styled?.getAttribute("style")?.match(/url\(["']?([^"')]+)["']?\)/i);
  return match?.[1] ? absoluteWebUrl(match[1]) : "";
}

function parseUserMonoCollectionsPage(
  html: string,
  monoType: "character" | "person",
): Array<UserCharacterCollection | UserPersonCollection> {
  if (!html.trim()) return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  const results = new Map<number, UserCharacterCollection | UserPersonCollection>();
  const links = document.querySelectorAll<HTMLAnchorElement>(`a[href*="/${monoType}/"]`);
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const matchedId = href.match(new RegExp(`/${monoType}/(\\d+)`))?.[1];
    if (!matchedId) continue;
    const id = Number(matchedId);
    const container = link.closest("li, article, .item, .userContainer") || link.parentElement;
    if (!container) continue;
    const titleLink = Array.from(container.querySelectorAll<HTMLAnchorElement>(`a[href*="/${monoType}/${id}"]`))
      .find((candidate) => candidate.textContent?.trim());
    const name = titleLink?.textContent?.trim() || link.getAttribute("title")?.trim() || "";
    if (!name) continue;
    const image = imageFromElement(container);
    const base = { id, name, type: 1, images: image ? { medium: image } : undefined, created_at: "" };
    results.set(id, monoType === "person" ? { ...base, career: [] } : base);
  }
  return [...results.values()];
}

function parseUserIndicesPage(html: string, page = webIndexPage.value): { items: WebIndexSummary[]; hasNext: boolean } {
  if (!html.trim()) return { items: [], hasNext: false };
  const document = new DOMParser().parseFromString(html, "text/html");
  const indexed = new Map<number, WebIndexSummary>();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/index/"]')) {
    const matchedId = link.getAttribute("href")?.match(/\/index\/(\d+)/)?.[1];
    if (!matchedId) continue;
    const id = Number(matchedId);
    const element = link.closest("li, article, .item, .index-item") || link.parentElement;
    if (!element) continue;
    const titleLink = Array.from(element.querySelectorAll<HTMLAnchorElement>(`a[href*="/index/${id}"]`))
      .find((candidate) => candidate.textContent?.trim());
    const title = titleLink?.textContent?.trim() || link.getAttribute("title")?.trim() || "";
    if (!title) continue;
    const numbers = Array.from(element.querySelectorAll<HTMLElement>(".stats .num, .num"))
      .map((node) => Number(node.textContent?.trim()))
      .filter(Number.isFinite);
    indexed.set(id, {
      id,
      title,
      description: element.querySelector(".desc, .description, .tip_j")?.textContent?.trim() || "",
      total: numbers.reduce((sum, value) => sum + value, 0),
    });
  }
  const items = [...indexed.values()];
  const nextPage = page + 1;
  const hasNext = Array.from(document.querySelectorAll<HTMLAnchorElement>('.page_inner a[href*="page="]'))
    .some((link) => Number(new URL(link.href, "https://bangumi.tv").searchParams.get("page")) === nextPage);
  return { items, hasNext };
}

function parseSubjectTypeFromElement(element: HTMLElement): number {
  const typeFromText = (value: string) => {
    const normalized = value.replace(/\s+/g, " ");
    const classMatch = normalized.match(/(?:subject[_-]?type|type)[_-]?([1-6])\b/i);
    if (classMatch) return Number(classMatch[1]);
    if (normalized.includes("\u52a8\u753b")) return 2;
    if (normalized.includes("\u4e66\u7c4d")) return 1;
    if (normalized.includes("\u6e38\u620f")) return 4;
    if (normalized.includes("\u97f3\u4e50")) return 3;
    if (normalized.includes("\u4e09\u6b21\u5143")) return 6;
    return 0;
  };
  const classNames = [
    element.getAttribute("class") || "",
    ...Array.from(element.querySelectorAll<HTMLElement>("[class]")).map((node) => node.getAttribute("class") || ""),
  ];
  for (const value of classNames) {
    const type = typeFromText(value);
    if (type) return type;
  }
  const labels = [
    element.getAttribute("title") || "",
    element.getAttribute("aria-label") || "",
    ...Array.from(element.querySelectorAll<HTMLElement>("[title], [aria-label]")).flatMap((node) => [
      node.getAttribute("title") || "",
      node.getAttribute("aria-label") || "",
    ]),
  ];
  for (const value of labels) {
    const type = typeFromText(value);
    if (type) return type;
  }
  return 0;
}
function parseIndexPrefix(element: HTMLElement): string | undefined {
  const prefix = element.querySelector<HTMLElement>("h2 .badge_job, h3 .badge_job, h4 .badge_job")
    ?.textContent
    ?.replace(/\s+/g, " ")
    .trim();
  return prefix || undefined;
}

function parseIndexComment(element: HTMLElement, name: string, id: number): string {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const isMetadata = (value: string) => {
    const text = normalize(value);
    return !text
      || text === name
      || text === `#${id}`
      || /^(?:\u7c7b\u578b|\u5206\u7c7b|\u52a8\u753b|\u4e66\u7c4d|\u6e38\u620f|\u97f3\u4e50|\u4e09\u6b21\u5143)\b/.test(text);
  };

  const dataComment = normalize(element.getAttribute("data-comment") || "");
  if (dataComment && !isMetadata(dataComment)) return dataComment;

  const explicit = Array.from(element.querySelectorAll<HTMLElement>(
    '[data-comment], [class~="comment"], [class*="comment"], .desc, .description, .intro',
  ))
    .map((node) => node.getAttribute("data-comment") || node.textContent || "")
    .map(normalize)
    .find((value) => !isMetadata(value));
  if (explicit) return explicit;

  const legacy = Array.from(element.querySelectorAll<HTMLElement>(".prsn_info .tip, .subject_info, .info, .tip"))
    .map((node) => node.textContent || "")
    .map(normalize)
    .find((value) => !isMetadata(value));
  if (legacy) return legacy;

  return Array.from(element.querySelectorAll<HTMLElement>("p"))
    .map((node) => node.textContent || "")
    .map(normalize)
    .find((value) => !isMetadata(value)) || "";
}

function parseIndexPage(html: string): { subjects: IndexSubject[]; canAddRelated: boolean } {
  if (!html.trim()) return { subjects: [], canAddRelated: false };
  const document = new DOMParser().parseFromString(html, "text/html");
  const items: IndexSubject[] = [];
  const kinds: Record<string, NonNullable<IndexSubject["kind"]>> = {
    subject: "subject",
    character: "character",
    person: "person",
    ep: "episode",
    blog: "blog",
    group_topic: "group_topic",
    subject_topic: "subject_topic",
  };

  for (const element of document.querySelectorAll<HTMLElement>('[id^="item_"]')) {
    const typedMatch = element.id.match(/^item_(character|person|ep|blog|group_topic|subject_topic)(\d+)$/);
    const subjectMatch = element.id.match(/^item_(\d+)$/);
    if (!typedMatch && !subjectMatch) continue;
    const rawKind = typedMatch?.[1] || "subject";
    const rawId = typedMatch?.[2] || subjectMatch?.[1] || "";
    const kind = kinds[rawKind];
    const id = Number(rawId);
    const relationValue = element.getAttribute("attr-index-related");
    const relationId = relationValue && /^\d+$/.test(relationValue) ? Number(relationValue) : undefined;
    const pathKind = ({
      subject: "subject",
      group_topic: "group/topic",
      subject_topic: "subject/topic",
    } as Record<string, string>)[rawKind] || rawKind;
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>(`a[href*="/${pathKind}/${id}"]`));
    const titleLink = links.find((link) => link.closest("h2, h3, h4") && link.textContent?.trim())
      || links.find((link) => link.textContent?.trim());
    const name = titleLink?.textContent?.trim() || titleLink?.getAttribute("title")?.trim() || "";
    if (!name || !Number.isInteger(id)) continue;
    const prefix = parseIndexPrefix(element);
    const image = imageFromElement(element);
    const type = kind === "subject" ? parseSubjectTypeFromElement(element) : 0;
    const comment = parseIndexComment(element, name, id);
    items.push({
      id,
      relation_id: relationId,
      prefix,
      type,
      kind,
      name,
      images: image ? { medium: image } : undefined,
      comment,
      added_at: "",
    });
  }

  const canAddRelated = Boolean(document.querySelector(
    'form#newIndexRelatedForm[action$="/add_related"], form[action$="/add_related"]',
  ));
  return { subjects: items, canAddRelated };
}

async function loadIndexCollectedState(indexId: number, loadVersion: number) {
  indexCollectionLoading.value = true;
  indexCollected.value = false;

  if (indexListMode.value === "collected" && webIndices.value.some((item) => item.id === indexId)) {
    indexCollected.value = true;
    indexCollectionLoading.value = false;
    return;
  }

  let page = 1;
  while (loadVersion === indexLoadVersion) {
    const result = await bangumi.fetchUserIndicesPage(currentUsername.value, true, page);
    if (!result.ok) break;
    const parsed = parseUserIndicesPage(result.data, page);
    if (parsed.items.some((item) => item.id === indexId)) {
      indexCollected.value = true;
      break;
    }
    if (!parsed.hasNext) break;
    page += 1;
  }

  if (loadVersion === indexLoadVersion) indexCollectionLoading.value = false;
}

async function loadUserIndices(reset = false) {
  if (!authenticated.value || !currentUsername.value) return;
  if (reset) webIndexPage.value = 1;
  webIndicesLoading.value = true;
  webIndicesError.value = "";
  const result = await bangumi.fetchUserIndicesPage(
    currentUsername.value,
    indexListMode.value === "collected",
    webIndexPage.value,
  );
  if (!result.ok) {
    webIndices.value = [];
    webIndexHasNext.value = false;
    webIndicesError.value = result.error;
  } else {
    const parsed = parseUserIndicesPage(result.data);
    webIndices.value = parsed.items;
    webIndexHasNext.value = parsed.hasNext;
  }
  webIndicesLoading.value = false;
}

async function changeWebIndexPage(direction: -1 | 1) {
  webIndexPage.value = Math.max(1, webIndexPage.value + direction);
  await loadUserIndices();
}

function openCharacterDetail(id: number) {
  activeTab.value = "character";
  emit("openCharacter", id);
}

function openPersonDetail(id: number) {
  activeTab.value = "person";
  emit("openPerson", id);
}

function parseSubjectTypeFromPage(html: string): number | undefined {
  if (!html.trim()) return undefined;
  const document = new DOMParser().parseFromString(html, "text/html");
  const typeLabels: Array<[string, number]> = [
    ["\u52a8\u753b", 2],
    ["\u4e66\u7c4d", 1],
    ["\u6e38\u620f", 4],
    ["\u97f3\u4e50", 3],
    ["\u4e09\u6b21\u5143", 6],
  ];
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("#infobox li, #infobox, .subject_info li, .subject_info"));
  const typePattern = /(?:\u7c7b\u578b|\u7c7b\u522b)\s*[:\uFF1A]\s*([^\s/|]+)/;
  for (const element of candidates) {
    const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
    const value = text.match(typePattern)?.[1];
    if (!value) continue;
    const matched = typeLabels.find(([label]) => value === label || value.includes(label));
    if (matched) return matched[1];
  }
  return undefined;
}
async function enrichIndexSubjectTypes(subjects: IndexSubject[], indexId: number) {
  const enrichmentVersion = indexTypeEnrichmentVersion.value;
  const pending = subjects.filter((subject) => subject.kind === "subject" && subject.type === 0);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      if (enrichmentVersion !== indexTypeEnrichmentVersion.value) return;
      const subject = pending[cursor++];
      const result = await bangumi.fetchSubjectPage(subject.id);
      if (indexDetail.value?.id !== indexId) return;
      if (result.ok) {
        const type = parseSubjectTypeFromPage(result.data);
        if (type !== undefined) subject.type = type;
      }
      completed += 1;
      indexLoadingProgress.value = 50 + Math.round((completed / pending.length) * 35);
      indexLoadingMessage.value = `正在补充条目类型（${completed}/${pending.length}）...`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => worker()));
}
async function loadIndexSubjects(reset = false) {
  if (!indexDetail.value) return;
  const indexId = indexDetail.value.id;
  if (reset) indexOffset.value = 0;
  const result = await bangumi.fetchIndexPage(indexId);
  if (indexDetail.value?.id !== indexId) return;
  if (!result.ok) {
    indexError.value = result.error;
    return;
  }
  const { subjects: parsedSubjects, canAddRelated } = parseIndexPage(result.data);
  indexLoadingProgress.value = 50;
  indexLoadingMessage.value = "正在解析目录内容...";
  indexCanAddRelated.value = canAddRelated;
  if (indexTypeEnrichmentSkipped.value) {
    allIndexSubjects.value = parsedSubjects;
    indexDetail.value.total = allIndexSubjects.value.length;
    refreshIndexSubjectPage();
    return;
  }
  await enrichIndexSubjectTypes(parsedSubjects, indexId);
  allIndexSubjects.value = parsedSubjects;
  indexDetail.value.total = allIndexSubjects.value.length;
  refreshIndexSubjectPage();
}

async function ensureIndexWebCookie(loadVersion: number): Promise<boolean> {
  indexLoadingProgress.value = 5;
  indexLoadingMessage.value = "正在检查 Cookie 可用性...";
  const validation = await bangumi.validateWebCookie();
  if (loadVersion !== indexLoadVersion) return false;

  if (!validation.ok) {
    indexError.value = `Cookie 可用性检查失败：${validation.error}`;
    indexLoading.value = false;
    return false;
  }

  if (validation.data.valid) {
    indexLoadingProgress.value = 15;
    indexLoadingMessage.value = "Cookie 可用，正在读取目录详情...";
    return true;
  }

  if (!validation.data.configured) {
    indexError.value = validation.data.reason || "此功能需要先配置 Bangumi 网页 Cookie。";
    indexLoading.value = false;
    appStore.showCookieSetupPrompt("查看目录详情");
    return false;
  }

  indexLoadingProgress.value = 10;
  indexLoadingMessage.value = "Cookie 已失效，正在自动更新...";
  const restored = await bangumi.restoreWebCookieFromEmbeddedSession();
  if (loadVersion !== indexLoadVersion) return false;
  if (!restored.ok) {
    indexError.value = `Cookie 自动更新失败：${restored.error}`;
    indexLoading.value = false;
    appStore.showCookieSetupPrompt("查看目录详情");
    return false;
  }

  indexLoadingProgress.value = 12;
  indexLoadingMessage.value = "正在确认更新后的 Cookie...";
  const revalidation = await bangumi.validateWebCookie();
  if (loadVersion !== indexLoadVersion) return false;
  if (!revalidation.ok || !revalidation.data.valid) {
    const reason = revalidation.ok
      ? revalidation.data.reason || "更新后的 Cookie 仍不可用。"
      : revalidation.error;
    indexError.value = `Cookie 自动更新失败：${reason}`;
    indexLoading.value = false;
    appStore.showCookieSetupPrompt("查看目录详情");
    return false;
  }

  indexLoadingProgress.value = 15;
  indexLoadingMessage.value = "Cookie 更新完成，正在读取目录详情...";
  appStore.showToast("Cookie 已自动更新。", "success");
  return true;
}

async function openIndex(rawId: string | number = indexIdInput.value) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    indexError.value = "请输入有效的目录 ID。";
    return;
  }
  const loadVersion = ++indexLoadVersion;
  indexDetailMode.value = "browse";
  showIndexBackToTop.value = false;
  indexDrawerOpen.value = true;
  indexLoading.value = true;
  indexTypeEnrichmentSkipped.value = false;
  indexTypeEnrichmentVersion.value += 1;
  indexLoadingProgress.value = 5;
  indexLoadingMessage.value = "正在检查 Cookie 可用性...";
  indexError.value = "";
  indexDetail.value = null;
  indexCanAddRelated.value = false;
  indexCollected.value = false;
  indexCollectionLoading.value = false;
  indexCollectionSaving.value = false;
  deleteIndexDialogOpen.value = false;
  deleteIndexSubmitting.value = false;
  deleteIndexError.value = "";
  allIndexSubjects.value = [];
  indexSubjects.value = [];
  addForm.error = "";
  if (!await ensureIndexWebCookie(loadVersion)) return;
  if (loadVersion !== indexLoadVersion) return;

  const result = await bangumi.getIndex(id);
  if (loadVersion !== indexLoadVersion) return;
  if (!result.ok) {
    indexError.value = result.error;
    indexLoading.value = false;
    return;
  }
  indexDetail.value = result.data;
  indexLoadingProgress.value = 30;
  indexLoadingMessage.value = "正在读取目录条目...";
  indexIdInput.value = String(id);
  editForm.title = result.data.title;
  editForm.description = result.data.desc;
  rememberIndex(id);
  await nextTick();
  indexDetailContentRef.value?.scrollTo({ top: 0, behavior: "auto" });
  if (authenticated.value && !canEditIndex.value) void loadIndexCollectedState(id, loadVersion);
  await loadIndexSubjects(true);
  if (loadVersion !== indexLoadVersion) return;
  indexLoading.value = false;
  indexLoadingProgress.value = 100;
  indexLoadingMessage.value = "目录加载完成";
}

function skipIndexTypeEnrichment() {
  indexTypeEnrichmentSkipped.value = true;
  indexTypeEnrichmentVersion.value += 1;
  indexLoadingProgress.value = 100;
  indexLoadingMessage.value = "已跳过条目类型补充";
  indexLoading.value = false;
  indexCategoryFilter.value = "all";
  refreshIndexSubjectPage();
}

function closeIndex() {
  indexLoadVersion += 1;
  subjectSearchVersion += 1;
  if (subjectSearchTimer) clearTimeout(subjectSearchTimer);
  indexDrawerOpen.value = false;
  indexSuspendedForSubject.value = false;
  suspendedIndexScrollTop.value = 0;
  indexDetailMode.value = "browse";
  showIndexBackToTop.value = false;
  appStore.detailBackToTopVisible.value = false;
  appStore.detailDrawerOpen.value = false;
  indexLoading.value = false;
  indexError.value = "";
  indexDetail.value = null;
  indexCanAddRelated.value = false;
  indexCollected.value = false;
  indexCollectionLoading.value = false;
  indexCollectionSaving.value = false;
  deleteIndexDialogOpen.value = false;
  deleteIndexSubmitting.value = false;
  deleteIndexError.value = "";
  allIndexSubjects.value = [];
  indexSubjects.value = [];
  subjectSearchQuery.value = "";
  subjectSearchResults.value = [];
  subjectSearchLoading.value = false;
  subjectSearchError.value = "";
  subjectSearchOpen.value = false;
  selectedSearchSubject.value = null;
  addForm.subjectId = "";
  addForm.error = "";
  editingSubjectId.value = null;
}

function setIndexDetailMode(mode: IndexDetailMode) {
  if (mode === "edit" && !canEditIndex.value) return;
  indexDetailMode.value = mode;
  if (mode === "browse") editingSubjectId.value = null;
}

function onIndexDetailScroll(event: Event) {
  const target = event.target;
  if (target instanceof HTMLElement) showIndexBackToTop.value = target.scrollTop > 280;
}

function scrollIndexDetailToTop() {
  indexDetailContentRef.value?.scrollTo({ top: 0, behavior: "smooth" });
}

function updateIndicator(
  container: HTMLElement | null,
  activeTabElement: HTMLElement | null,
  target: typeof indexListIndicatorStyle,
) {
  if (!container || !activeTabElement) return;
  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTabElement.getBoundingClientRect();
  target.value = {
    left: `${tabRect.left - containerRect.left}px`,
    width: `${tabRect.width}px`,
  };
}

function updateIndexIndicators() {
  updateIndicator(
    indexListTabsRef.value,
    indexListMode.value === "created" ? indexCreatedTabRef.value : indexCollectedTabRef.value,
    indexListIndicatorStyle,
  );
  updateIndicator(
    indexDetailModeRef.value,
    indexDetailMode.value === "browse" ? indexBrowseTabRef.value : indexEditTabRef.value,
    indexDetailIndicatorStyle,
  );
}

async function openIndexSubject(subject: IndexSubject) {
  if (subject.kind && !["subject", "character", "person"].includes(subject.kind)) {
    const path = ({
      episode: "ep",
      blog: "blog",
      group_topic: "group/topic",
      subject_topic: "subject/topic",
    } as Record<string, string>)[subject.kind];
    if (path) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(`https://bangumi.tv/${path}/${subject.id}`);
    }
    return;
  }
  suspendedIndexScrollTop.value = indexDetailContentRef.value?.scrollTop ?? 0;
  indexSuspendedForSubject.value = true;
  indexDrawerOpen.value = false;
  showIndexBackToTop.value = false;
  await nextTick();
  if (subject.kind === "character") emit("openCharacter", subject.id);
  else if (subject.kind === "person") emit("openPerson", subject.id);
  else if (!subject.kind || subject.kind === "subject") emit("openSubject", subject.id);
}

async function restoreIndexDetail() {
  if (!indexSuspendedForSubject.value || !indexDetail.value) return;
  indexSuspendedForSubject.value = false;
  indexDrawerOpen.value = true;
  await nextTick();
  indexDetailContentRef.value?.scrollTo({ top: suspendedIndexScrollTop.value, behavior: "auto" });
  showIndexBackToTop.value = suspendedIndexScrollTop.value > 280;
  updateIndexIndicators();
}

async function openCreateIndexDialog() {
  indexError.value = "";
  createIndexDialogOpen.value = true;
  await nextTick();
  createIndexTitleRef.value?.focus();
}

function closeCreateIndexDialog() {
  if (createForm.submitting) return;
  createIndexDialogOpen.value = false;
  indexError.value = "";
}

async function createIndex() {
  if (!authenticated.value || !createForm.title.trim()) return;
  createForm.submitting = true;
  indexError.value = "";
  const result = await bangumi.createIndex({
    title: createForm.title.trim(),
    description: createForm.description.trim(),
  });
  createForm.submitting = false;
  if (!result.ok) {
    indexError.value = result.error;
    return;
  }
  createForm.title = "";
  createForm.description = "";
  createIndexDialogOpen.value = false;
  appStore.showToast("目录已创建。", "success");
  await openIndex(result.data.id);
}

async function saveIndex() {
  if (!indexDetail.value || !canEditIndex.value || !editForm.title.trim()) return;
  editForm.submitting = true;
  const result = await bangumi.editIndex(indexDetail.value.id, {
    title: editForm.title.trim(),
    description: editForm.description.trim(),
  });
  editForm.submitting = false;
  if (!result.ok) {
    indexError.value = result.error;
    return;
  }
  indexDetail.value = result.data;
  appStore.showToast("目录信息已保存。", "success");
}

function openDeleteIndexDialog() {
  if (!indexDetail.value || !canEditIndex.value) return;
  deleteIndexError.value = "";
  deleteIndexDialogOpen.value = true;
}

function closeDeleteIndexDialog() {
  if (deleteIndexSubmitting.value) return;
  deleteIndexDialogOpen.value = false;
  deleteIndexError.value = "";
}

async function deleteCurrentIndex() {
  if (!indexDetail.value || !canEditIndex.value || deleteIndexSubmitting.value) return;
  const indexId = indexDetail.value.id;
  deleteIndexSubmitting.value = true;
  deleteIndexError.value = "";
  const result = await bangumi.deleteIndex(indexId);
  deleteIndexSubmitting.value = false;
  if (!result.ok) {
    deleteIndexError.value = result.error;
    return;
  }

  recentIndexIds.value = recentIndexIds.value.filter((id) => id !== indexId);
  localStorage.setItem(RECENT_INDICES_KEY, JSON.stringify(recentIndexIds.value));
  deleteIndexDialogOpen.value = false;
  closeIndex();
  await loadUserIndices(true);
  appStore.showToast("目录已删除。", "success");
}

async function setIndexCollected(collected: boolean) {
  if (!indexDetail.value || !authenticated.value || indexCollectionSaving.value) return;
  indexCollectionSaving.value = true;
  const result = await bangumi.setIndexCollected(indexDetail.value.id, collected);
  indexCollectionSaving.value = false;
  if (!result.ok) {
    indexError.value = result.error;
    return;
  }
  indexCollected.value = collected;
  indexDetail.value.stat.collects = Math.max(0, indexDetail.value.stat.collects + (collected ? 1 : -1));
  appStore.showToast(collected ? "已收藏目录。" : "已取消收藏目录。", "success");
}

async function addSubject() {
  if (!indexDetail.value || !canEditIndex.value || !indexCanAddRelated.value) return;
  const subjectId = Number(addForm.subjectId);
  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    addForm.error = "请输入有效的条目 ID。";
    return;
  }
  addForm.submitting = true;
  addForm.error = "";
  const sort = addForm.sort === "" ? undefined : Number(addForm.sort);
  const normalizedSort = Number.isFinite(sort) ? sort : undefined;
  const result = selectedSearchSubject.value
    ? await bangumi.addSubjectToIndex(indexDetail.value.id, {
      subject_id: subjectId,
      sort: normalizedSort,
      comment: addForm.comment.trim() || undefined,
    })
    : ["person", "character"].includes(subjectSearchType.value)
      ? await bangumi.addIndexEntityViaWeb(
        indexDetail.value.id,
        subjectSearchType.value as "person" | "character",
        subjectId,
      )
      : await bangumi.addSubjectToIndex(indexDetail.value.id, {
        subject_id: subjectId,
        sort: normalizedSort,
        comment: addForm.comment.trim() || undefined,
      });
  addForm.submitting = false;
  if (!result.ok) {
    addForm.error = result.error;
    return;
  }
  addForm.subjectId = "";
  addForm.sort = "";
  addForm.comment = "";
  addForm.error = "";
  subjectSearchQuery.value = "";
  selectedSearchSubject.value = null;
  subjectSearchResults.value = [];
  subjectSearchOpen.value = false;
  await loadIndexSubjects(true);
  indexDetail.value.total = allIndexSubjects.value.length;
  appStore.showToast(
    ["person", "character"].includes(subjectSearchType.value) ? "已收集至目录。" : "条目已加入目录。",
    "success",
  );
}

function clearSubjectSearchSelection() {
  selectedSearchSubject.value = null;
  addForm.subjectId = "";
  addForm.error = "";
}

function selectSearchSubject(result: IndexSearchResult) {
  selectedSearchSubject.value = result.subject ?? null;
  addForm.subjectId = String(result.id);
  addForm.error = "";
  subjectSearchQuery.value = result.title;
  subjectSearchOpen.value = false;
  subjectSearchActiveIndex.value = -1;
}

async function searchIndexSubjects(query: string, version: number) {
  subjectSearchLoading.value = true;
  subjectSearchError.value = "";
  const searchType = subjectSearchType.value;
  const result = searchType === "person"
    ? await bangumi.searchPersons(query, { limit: 8, sort: "match" })
    : searchType === "character"
      ? await bangumi.searchCharacters(query, { limit: 8, sort: "match" })
      : await bangumi.searchSubjects(query, {
        limit: 8,
        sort: "match",
        subject_types: subjectTypeFilter(searchType),
      });
  if (version !== subjectSearchVersion) return;
  subjectSearchLoading.value = false;
  if (!result.ok) {
    subjectSearchResults.value = [];
    subjectSearchError.value = result.error;
    subjectSearchOpen.value = true;
    return;
  }
  subjectSearchResults.value = searchType === "person"
    ? (result.data.data as SearchPerson[]).map((person) => ({
      id: person.id,
      kind: "person" as const,
      title: person.name,
      subtitle: person.career.join(" / "),
      meta: `人物 · #${person.id}`,
      images: person.images,
    }))
    : searchType === "character"
      ? (result.data.data as SearchCharacter[]).map((character) => ({
        id: character.id,
        kind: "character" as const,
        title: character.name,
        subtitle: "",
        meta: `角色 · #${character.id}`,
        images: character.images,
      }))
      : (result.data.data as SearchSubject[]).map((subject) => ({
        id: subject.id,
        kind: "subject" as const,
        title: subject.name_cn || subject.name,
        subtitle: subject.name_cn && subject.name_cn !== subject.name ? subject.name : "",
        meta: `${subjectTypeLabel(subject.type)} · #${subject.id}${subject.date ? ` · ${subject.date}` : ""}`,
        images: subject.images,
        subject,
      }));
  subjectSearchActiveIndex.value = subjectSearchResults.value.length > 0 ? 0 : -1;
  subjectSearchOpen.value = true;
}

function changeSubjectSearchType() {
  clearSubjectSearchSelection();
  subjectSearchResults.value = [];
  subjectSearchError.value = "";
  subjectSearchVersion += 1;
  if (subjectSearchTimer) clearTimeout(subjectSearchTimer);
  if (subjectSearchQuery.value.trim()) handleSubjectSearchInput();
}

function handleSubjectSearchInput() {
  const query = subjectSearchQuery.value.trim();
  addForm.error = "";
  if (selectedSearchSubject.value && query !== (selectedSearchSubject.value.name_cn || selectedSearchSubject.value.name)) {
    clearSubjectSearchSelection();
  }
  if (/^\d+$/.test(query)) addForm.subjectId = query;
  else if (!selectedSearchSubject.value) addForm.subjectId = "";

  if (subjectSearchTimer) clearTimeout(subjectSearchTimer);
  subjectSearchVersion += 1;
  subjectSearchError.value = "";
  subjectSearchActiveIndex.value = -1;
  if (query.length < 2 || /^\d+$/.test(query)) {
    subjectSearchLoading.value = false;
    subjectSearchResults.value = [];
    subjectSearchOpen.value = Boolean(query);
    return;
  }
  subjectSearchLoading.value = true;
  const version = subjectSearchVersion;
  subjectSearchTimer = setTimeout(() => void searchIndexSubjects(query, version), 280);
}

function handleSubjectSearchKeydown(event: KeyboardEvent) {
  if (!subjectSearchOpen.value || subjectSearchResults.value.length === 0) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    subjectSearchActiveIndex.value = (subjectSearchActiveIndex.value + 1) % subjectSearchResults.value.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    subjectSearchActiveIndex.value = (subjectSearchActiveIndex.value - 1 + subjectSearchResults.value.length) % subjectSearchResults.value.length;
  } else if (event.key === "Enter" && subjectSearchActiveIndex.value >= 0) {
    event.preventDefault();
    selectSearchSubject(subjectSearchResults.value[subjectSearchActiveIndex.value]);
  } else if (event.key === "Escape") {
    subjectSearchOpen.value = false;
  }
}

function handleSubjectSearchFocus() {
  if (subjectSearchBlurTimer) clearTimeout(subjectSearchBlurTimer);
  if (subjectSearchQuery.value.trim()) subjectSearchOpen.value = true;
}

function handleSubjectSearchBlur() {
  subjectSearchBlurTimer = setTimeout(() => {
    subjectSearchOpen.value = false;
  }, 120);
}

function ensureIndexSubjectRelation(subject: IndexSubject): boolean {
  if (subject.relation_id) return true;
  appStore.showToast("该目录条目没有关联键，无法编辑或移除。", "error");
  return false;
}
function beginEditSubject(subject: IndexSubject) {
  if (!ensureIndexSubjectRelation(subject)) return;
  editingSubjectId.value = subject.id;
  subjectEditForm.sort = "";
  subjectEditForm.comment = subject.comment || "";
}

async function saveSubject(subjectId: number) {
  if (!indexDetail.value || !canEditIndex.value) return;
  subjectEditForm.submitting = true;
  const sort = subjectEditForm.sort === "" ? undefined : Number(subjectEditForm.sort);
  const result = await bangumi.editIndexSubject(indexDetail.value.id, subjectId, {
    sort: Number.isFinite(sort) ? sort : undefined,
    comment: subjectEditForm.comment,
  });
  subjectEditForm.submitting = false;
  if (!result.ok) {
    indexError.value = result.error;
    return;
  }
  editingSubjectId.value = null;
  await loadIndexSubjects();
}

async function removeSubject(subject: IndexSubject) {
  if (!indexDetail.value || !canEditIndex.value || !ensureIndexSubjectRelation(subject)) return;
  const subjectId = subject.id;
  const result = await bangumi.deleteIndexSubject(indexDetail.value.id, subjectId);
  if (!result.ok) {
    indexError.value = result.error;
    return;
  }
  await loadIndexSubjects(true);
  indexDetail.value.total = allIndexSubjects.value.length;
  appStore.showToast("条目已从目录移除。", "success");
}

async function changeIndexPage(direction: -1 | 1) {
  indexOffset.value = Math.max(0, indexOffset.value + direction * INDEX_PAGE_SIZE);
  refreshIndexSubjectPage();
  await nextTick();
  indexDetailContentRef.value?.scrollTo({ top: 0, behavior: "smooth" });
}

watch(() => props.activeTab, (tab) => {
  activeTab.value = tab;
  if (tab !== "index" && (indexDrawerOpen.value || indexSuspendedForSubject.value)) closeIndex();
  if (tab === "index") void nextTick(updateIndexIndicators);
});

watch([activeTab, authenticated, currentUsername], ([tab, isAuthenticated, username]) => {
  if (!isAuthenticated || !username) return;
  if (tab === "index") {
    void loadUserIndices(true);
    void nextTick(updateIndexIndicators);
  }
  else void loadMonoCollections();
}, { immediate: true });

watch(indexListMode, () => {
  if (activeTab.value === "index") void loadUserIndices(true);
  void nextTick(updateIndexIndicators);
});

watch([indexDetailMode, indexDrawerOpen, indexDetail], () => {
  void nextTick(updateIndexIndicators);
});

watch(indexDrawerOpen, (open) => {
  appStore.detailDrawerOpen.value = open;
});

watch(showIndexBackToTop, (visible) => {
  appStore.detailBackToTopVisible.value = visible;
});

onMounted(() => {
  loadRecentIndices();
  void nextTick(updateIndexIndicators);
  window.addEventListener("resize", updateIndexIndicators);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateIndexIndicators);
  if (subjectSearchTimer) clearTimeout(subjectSearchTimer);
  if (subjectSearchBlurTimer) clearTimeout(subjectSearchBlurTimer);
  if (indexDrawerOpen.value) appStore.detailDrawerOpen.value = false;
  if (showIndexBackToTop.value) appStore.detailBackToTopVisible.value = false;
});

async function refreshLibrary() {
  if (activeTab.value === "index") {
    await loadUserIndices();
  } else {
    await loadMonoCollections();
  }
}

defineExpose({
  refresh: refreshLibrary,
  openCharacterDetail,
  openPersonDetail,
  restoreIndexDetail,
});
</script>

<template>
  <section class="library">
      <div v-if="props.showTabs" class="library__tabs" role="tablist" aria-label="资料库类型">
        <button class="tab" :class="{ 'is-active': activeTab === 'character' }" type="button" @click="switchTab('character')">角色</button>
        <button class="tab" :class="{ 'is-active': activeTab === 'person' }" type="button" @click="switchTab('person')">人物</button>
        <button class="tab" :class="{ 'is-active': activeTab === 'index' }" type="button" @click="switchTab('index')">目录</button>
      </div>

      <section v-if="activeTab !== 'index'">
        <p v-if="!authenticated" class="empty">登录后可查看角色与人物收藏。</p>
        <p v-else-if="loading" class="empty">收藏加载中...</p>
        <p v-else-if="error" class="empty">收藏加载失败：{{ error }}</p>
        <div v-else class="library-grid">
          <button
            v-for="item in activeTab === 'character' ? characters : persons"
            :key="item.id"
            class="library-item"
            type="button"
            @click="activeTab === 'character' ? openCharacterDetail(item.id) : openPersonDetail(item.id)"
          >
            <span class="library-item__cover">
              <img v-if="cover(item.images)" :src="cover(item.images)" alt="" loading="lazy" />
              <span v-else>BG</span>
            </span>
            <span class="library-item__body">
              <strong>{{ item.name }}</strong>
              <small>{{ item.created_at ? `收藏于 ${new Date(item.created_at).toLocaleDateString()}` : "网页收藏" }}</small>
            </span>
          </button>
          <p v-if="(activeTab === 'character' ? characters : persons).length === 0" class="empty">暂无收藏。</p>
        </div>
      </section>

      <section v-else class="index-workspace">
        <p v-if="!authenticated" class="empty">登录后可查看与管理目录。</p>
        <div v-if="authenticated" ref="indexListTabsRef" class="index-list-tabs" role="tablist" aria-label="目录列表类型">
          <button ref="indexCreatedTabRef" class="tab" :class="{ 'is-active': indexListMode === 'created' }" type="button" @click="indexListMode = 'created'">我创建的</button>
          <button ref="indexCollectedTabRef" class="tab" :class="{ 'is-active': indexListMode === 'collected' }" type="button" @click="indexListMode = 'collected'">我收藏的</button>
          <button class="index-create-button" type="button" aria-label="创建目录" title="创建目录" @click="openCreateIndexDialog">+</button>
          <div class="tab-indicator" :style="indexListIndicatorStyle" />
        </div>
        <p v-if="webIndicesLoading" class="empty">目录列表加载中...</p>
        <p v-else-if="webIndicesError" class="empty">目录列表加载失败：{{ webIndicesError }}</p>
        <div v-else-if="authenticated" class="web-index-list">
          <button v-for="item in webIndices" :key="item.id" class="web-index-item" type="button" @click="openIndex(item.id)">
            <span>
              <strong>{{ item.title }}</strong>
              <small v-if="item.description">{{ item.description }}</small>
            </span>
            <span class="tag-chip">{{ item.total }} 条目</span>
          </button>
          <p v-if="webIndices.length === 0" class="empty">暂无目录。</p>
        </div>
        <Pager
          v-if="authenticated && (webIndexPage > 1 || webIndexHasNext)"
          :page-index="webIndexPage"
          :prev-disabled="webIndexPage <= 1 || webIndicesLoading"
          :next-disabled="!webIndexHasNext || webIndicesLoading"
          @prev="changeWebIndexPage(-1)"
          @next="changeWebIndexPage(1)"
        />

        <form class="index-open" @submit.prevent="openIndex()">
          <input v-model="indexIdInput" class="onboarding__input" inputmode="numeric" placeholder="目录 ID" />
          <button class="primary-button" type="submit" :disabled="indexLoading">打开目录</button>
        </form>
        <div v-if="recentIndexIds.length" class="index-recents">
          <span>最近打开</span>
          <button v-for="id in recentIndexIds" :key="id" class="tag-chip" type="button" @click="openIndex(id)">#{{ id }}</button>
        </div>
        <p v-if="indexError && !indexDrawerOpen" class="empty">{{ indexError }}</p>
      </section>

      <Transition name="link-confirm">
        <div
          v-if="createIndexDialogOpen"
          class="overlay index-create-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-index-title"
          @click.self="closeCreateIndexDialog"
        >
          <form class="modal index-create-modal" @submit.prevent="createIndex">
            <h3 id="create-index-title">创建目录</h3>
            <p>填写标题和简介，创建一个用于整理条目的新目录。</p>
            <p>目录是基于某一特定主题的个性化条目推荐，在目录中你可以添加任意分类的条目。</p>
            <input ref="createIndexTitleRef" v-model="createForm.title" class="onboarding__input" placeholder="目录标题" required />
            <textarea v-model="createForm.description" class="onboarding__input" rows="4" placeholder="目录描述（可选）" />
            <p v-if="indexError" class="index-create-modal__error">{{ indexError }}</p>
            <div class="modal__actions index-create-modal__actions">
              <button class="secondary-button" type="button" :disabled="createForm.submitting" @click="closeCreateIndexDialog">取消</button>
              <button class="primary-button" type="submit" :disabled="createForm.submitting">
                {{ createForm.submitting ? "创建中..." : "创建目录" }}
              </button>
            </div>
          </form>
        </div>
      </Transition>

      <Transition name="link-confirm">
        <div
          v-if="deleteIndexDialogOpen"
          class="overlay index-delete-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-index-title"
          aria-describedby="delete-index-description"
          @click.self="closeDeleteIndexDialog"
        >
          <div class="modal index-delete-modal">
            <h3 id="delete-index-title">删除目录</h3>
            <p id="delete-index-description">
              确定要删除“{{ indexDetail?.title || "未命名目录" }}”吗？目录及其中的条目关联将无法恢复。
            </p>
            <p v-if="deleteIndexError" class="index-delete-modal__error" role="alert">{{ deleteIndexError }}</p>
            <div class="modal__actions index-delete-modal__actions">
              <button class="secondary-button" type="button" :disabled="deleteIndexSubmitting" @click="closeDeleteIndexDialog">取消</button>
              <button class="index-delete-confirm" type="button" :disabled="deleteIndexSubmitting" @click="deleteCurrentIndex">
                {{ deleteIndexSubmitting ? "删除中..." : "确认删除" }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="drawer">
        <div v-if="indexDrawerOpen" class="drawer-backdrop">
          <div class="drawer-overlay" @click="closeIndex"></div>
          <aside class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="index-detail-title">
            <header class="detail-drawer__header">
              <h2 id="index-detail-title">{{ indexDetail?.title || "目录详情" }}</h2>
              <div class="detail-drawer__header-actions">
                <div v-if="indexDetail && canEditIndex" ref="indexDetailModeRef" class="index-detail-mode" role="group" aria-label="目录详情模式">
                  <button
                    ref="indexBrowseTabRef"
                    class="secondary-button index-detail-mode__tab"
                    :class="{ 'is-active': indexDetailMode === 'browse' }"
                    type="button"
                    @click="setIndexDetailMode('browse')"
                  >浏览</button>
                  <button
                    ref="indexEditTabRef"
                    class="secondary-button index-detail-mode__tab"
                    :class="{ 'is-active': indexDetailMode === 'edit' }"
                    type="button"
                    @click="setIndexDetailMode('edit')"
                  >编辑</button>
                  <div class="tab-indicator" :style="indexDetailIndicatorStyle" />
                </div>
                <button class="secondary-button" type="button" @click="closeIndex">关闭</button>
              </div>
            </header>
            <section v-if="indexLoading" class="detail-loading-state" role="status" aria-live="polite">
              <span class="spinner" aria-hidden="true"></span>
              <div class="detail-loading-progress">
                <div class="detail-loading-progress__label"><span>{{ indexLoadingMessage }}</span><strong>{{ indexLoadingProgress }}%</strong></div>
                <div class="detail-loading-progress__track"><div class="detail-loading-progress__bar" :style="{ width: `${indexLoadingProgress}%` }" /></div>
                <button v-if="indexLoadingProgress >= 50 && !indexTypeEnrichmentSkipped" class="secondary-button detail-loading-skip" type="button" @click="skipIndexTypeEnrichment">跳过补充类型</button>
              </div>
            </section>
            <section v-else-if="indexError" class="empty">{{ indexError }}</section>
            <section
              v-else-if="indexDetail"
              ref="indexDetailContentRef"
              class="detail-content index-detail-content"
              @scroll.passive="onIndexDetailScroll"
            >
              <article class="detail-section index-header">
                <div>
                  <p class="eyebrow">目录编号 #{{ indexDetail.id }}</p>
                  <h3>{{ indexDetail.title || "未命名目录" }}</h3>
                  <BbcodeSummary :content="indexDetail.desc" />
                  <p class="detail-muted">{{ indexDetail.creator.nickname || indexDetail.creator.username }} · {{ indexDetail.total }} 个条目 · {{ indexDetail.stat.collects }} 人收藏</p>
                </div>
                <div v-if="authenticated && !canEditIndex" class="index-header__actions">
                  <button
                    :class="indexCollected ? 'secondary-button' : 'primary-button'"
                    type="button"
                    :disabled="indexCollectionLoading || indexCollectionSaving"
                    @click="setIndexCollected(!indexCollected)"
                  >{{ indexCollectionLoading ? "检查收藏状态..." : indexCollectionSaving ? "保存中..." : indexCollected ? "取消收藏" : "收藏" }}</button>
                </div>
              </article>

              <form v-if="canEditIndex && indexDetailMode === 'edit'" class="detail-section index-form" @submit.prevent="saveIndex">
                <h4>编辑目录</h4>
                <input v-model="editForm.title" class="onboarding__input" required />
                <textarea v-model="editForm.description" class="onboarding__input" rows="3" />
                <div class="index-form__actions">
                  <button class="primary-button" type="submit" :disabled="editForm.submitting">{{ editForm.submitting ? "保存中..." : "保存" }}</button>
                  <button class="index-delete-button" type="button" :disabled="editForm.submitting" @click="openDeleteIndexDialog">删除目录</button>
                </div>
              </form>

              <form v-if="canEditIndex && indexCanAddRelated && indexDetailMode === 'edit'" class="detail-section index-add-form" @submit.prevent="addSubject">
                <div class="index-add-form__heading">
                  <h4>加入条目</h4>
                  <span>搜索名称，或直接输入条目 ID</span>
                </div>
                <div class="index-subject-search">
                  <div class="index-subject-search__field">
                    <select
                      v-model="subjectSearchType"
                      class="index-subject-search__type"
                      aria-label="搜索类型"
                      @change="changeSubjectSearchType"
                    >
                      <option value="all">全部</option>
                      <option value="anime">动画</option>
                      <option value="book">书籍</option>
                      <option value="game">游戏</option>
                      <option value="music">音乐</option>
                      <option value="real">三次元</option>
                      <option value="person">人物</option>
                      <option value="character">角色</option>
                    </select>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
                    <input
                      v-model="subjectSearchQuery"
                      class="onboarding__input"
                      type="search"
                      role="combobox"
                      autocomplete="off"
                      aria-label="搜索要加入目录的条目"
                      :aria-expanded="subjectSearchOpen"
                      aria-controls="index-subject-search-results"
                      :aria-activedescendant="subjectSearchActiveIndex >= 0 ? `index-subject-option-${subjectSearchResults[subjectSearchActiveIndex]?.kind}-${subjectSearchResults[subjectSearchActiveIndex]?.id}` : undefined"
                      placeholder="搜索条目名称或输入 ID"
                      required
                      @input="handleSubjectSearchInput"
                      @focus="handleSubjectSearchFocus"
                      @blur="handleSubjectSearchBlur"
                      @keydown="handleSubjectSearchKeydown"
                    />
                    <span v-if="subjectSearchLoading" class="index-subject-search__spinner" aria-label="搜索中" />
                    <button
                      v-else-if="subjectSearchQuery"
                      class="index-subject-search__clear"
                      type="button"
                      aria-label="清空搜索"
                      @click="subjectSearchQuery = ''; clearSubjectSearchSelection(); subjectSearchResults = []; subjectSearchOpen = false"
                    >×</button>
                  </div>
                  <Transition name="search-popover">
                    <div
                      v-if="subjectSearchOpen"
                      id="index-subject-search-results"
                      class="index-subject-search__popover"
                      role="listbox"
                    >
                      <p v-if="/^\d+$/.test(subjectSearchQuery.trim())" class="index-subject-search__hint">
                        将直接添加{{ subjectSearchTypeLabels[subjectSearchType] }} #{{ subjectSearchQuery.trim() }}
                      </p>
                      <p v-else-if="subjectSearchQuery.trim().length < 2" class="index-subject-search__hint">再输入一个字符开始搜索</p>
                      <p v-else-if="subjectSearchLoading" class="index-subject-search__hint">正在查找条目...</p>
                      <p v-else-if="subjectSearchError" class="index-subject-search__hint is-error">搜索失败：{{ subjectSearchError }}</p>
                      <template v-else-if="subjectSearchResults.length">
                        <button
                          v-for="(subject, resultIndex) in subjectSearchResults"
                          :id="`index-subject-option-${subject.kind}-${subject.id}`"
                          :key="`${subject.kind}-${subject.id}`"
                          class="index-subject-search__result"
                          :class="{ 'is-active': resultIndex === subjectSearchActiveIndex }"
                          type="button"
                          role="option"
                          :aria-selected="resultIndex === subjectSearchActiveIndex"
                          @mouseenter="subjectSearchActiveIndex = resultIndex"
                          @mousedown.prevent="selectSearchSubject(subject)"
                        >
                          <span class="index-subject-search__cover">
                            <img v-if="cover(subject.images)" :src="cover(subject.images)" alt="" loading="lazy" />
                            <span v-else>BG</span>
                          </span>
                          <span class="index-subject-search__copy">
                            <strong>{{ subject.title }}</strong>
                            <small v-if="subject.subtitle">{{ subject.subtitle }}</small>
                            <small>{{ subject.meta }}</small>
                          </span>
                          <span class="index-subject-search__select">选择</span>
                        </button>
                      </template>
                      <p v-else class="index-subject-search__hint">没有找到匹配条目</p>
                    </div>
                  </Transition>
                </div>
                <input v-if="!['person', 'character'].includes(subjectSearchType)" v-model="addForm.sort" class="onboarding__input" inputmode="numeric" placeholder="排序值（可选）" />
                <input v-if="!['person', 'character'].includes(subjectSearchType)" v-model="addForm.comment" class="onboarding__input" placeholder="备注（可选）" />
                <button
                  class="primary-button"
                  :class="{ 'index-add-form__collect-button': ['person', 'character'].includes(subjectSearchType) }"
                  type="submit"
                  :disabled="addForm.submitting || !addForm.subjectId"
                >
                  {{ addForm.submitting ? "加入中..." : "加入" }}
                </button>
                <p v-if="addForm.error" class="index-add-form__error" role="alert">添加失败：{{ addForm.error }}</p>
              </form>

              <div class="index-category-tabs" role="tablist" aria-label="按条目类别筛选">
                <button
                  v-for="tab in indexCategoryTabs"
                  :key="'index-category-' + tab.key"
                  class="filter-tab"
                  :class="{ 'is-active': indexCategoryFilter === tab.key }"
                  type="button"
                  role="tab"
                  :aria-selected="indexCategoryFilter === tab.key"
                  :disabled="indexTypeEnrichmentSkipped"
                  @click="setIndexCategoryFilter(tab.key)"
                >
                  {{ tab.label }} {{ indexCategoryCounts[tab.key] }}
                </button>
              </div>
              <div class="index-subjects">
                <article v-for="subject in indexSubjects" :key="subject.relation_id || `${subject.kind || 'subject'}-${subject.id}`" class="index-subject">
                  <button class="index-subject__main" type="button" @click="openIndexSubject(subject)">
                    <span class="index-subject__cover">
                      <img v-if="cover(subject.images)" :src="cover(subject.images)" alt="" loading="lazy" />
                      <span v-else>BG</span>
                    </span>
                    <span class="index-subject__body">
                      <strong :class="{
                        'broadcast-followed': subject.kind === 'subject' && appStore.broadcastMarker.parent.value && appStore.broadcastMarker.inIndex.value && !appStore.markerIconOnly.value && isFollowed(subject.id),
                        'is-wish': subject.kind === 'subject' && appStore.wishMarker.parent.value && appStore.wishMarker.inIndex.value && !appStore.markerIconOnly.value && subjectCollectionType(subject.id) === 1,
                        'is-collected': subject.kind === 'subject' && appStore.collectedMarker.parent.value && appStore.collectedMarker.inIndex.value && !appStore.markerIconOnly.value && subjectCollectionType(subject.id) === 2,
                        'is-watching': subject.kind === 'subject' && appStore.watchingMarker.parent.value && appStore.watchingMarker.inIndex.value && !appStore.markerIconOnly.value && subjectCollectionType(subject.id) === 3,
                        'is-onhold': subject.kind === 'subject' && appStore.onholdMarker.parent.value && appStore.onholdMarker.inIndex.value && !appStore.markerIconOnly.value && subjectCollectionType(subject.id) === 4,
                        'is-dropped': subject.kind === 'subject' && appStore.droppedMarker.parent.value && appStore.droppedMarker.inIndex.value && !appStore.markerIconOnly.value && subjectCollectionType(subject.id) === 5,
                      }">
                        <span v-if="subject.prefix" class="index-subject__prefix">{{ subject.prefix }}</span>
                        {{ subject.name }}
                        <template v-if="subject.kind === 'subject'">
                        <svg v-if="subject.kind === 'subject' && appStore.broadcastMarker.parent.value && appStore.broadcastMarker.inIndex.value && isFollowed(subject.id)" class="broadcast-followed__heart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>已关注配信</title><path d="M305 151.1L320 171.8L335 151.1C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1L576 231.7C576 343.9 436.1 474.2 363.1 529.9C350.7 539.3 335.5 544 320 544C304.5 544 289.2 539.4 276.9 529.9C203.9 474.2 64 343.9 64 231.7L64 229.1C64 155.6 123.6 96 197.1 96C239.8 96 280 116.5 305 151.1z"/></svg>
                        <svg v-if="appStore.wishMarker.parent.value && appStore.wishMarker.inIndex.value && subjectCollectionType(subject.id) === 1" class="is-wish__bookmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>想看</title><path d="M192 64C156.7 64 128 92.7 128 128L128 544C128 555.5 134.2 566.2 144.2 571.8C154.2 577.4 166.5 577.3 176.4 571.4L320 485.3L463.5 571.4C473.4 577.3 485.7 577.5 495.7 571.8C505.7 566.1 512 555.5 512 544L512 128C512 92.7 483.3 64 448 64L192 64z"/></svg>
                        <svg v-if="appStore.collectedMarker.parent.value && appStore.collectedMarker.inIndex.value && subjectCollectionType(subject.id) === 2" class="is-collected__check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>看过</title><path d="M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z"/></svg>
                        <svg v-if="appStore.watchingMarker.parent.value && appStore.watchingMarker.inIndex.value && subjectCollectionType(subject.id) === 3" class="is-watching__eye" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>在看</title><path d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"/></svg>
                        <svg v-if="appStore.onholdMarker.parent.value && appStore.onholdMarker.inIndex.value && subjectCollectionType(subject.id) === 4" class="is-onhold__eye-regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>搁置</title><path d="M320 144C254.8 144 201.2 173.6 160.1 211.7C121.6 247.5 95 290 81.4 320C95 350 121.6 392.5 160.1 428.3C201.2 466.4 254.8 496 320 496C385.2 496 438.8 466.4 479.9 428.3C518.4 392.5 545 350 558.6 320C545 290 518.4 247.5 479.9 211.7C438.8 173.6 385.2 144 320 144zM127.4 176.6C174.5 132.8 239.2 96 320 96C400.8 96 465.5 132.8 512.6 176.6C559.4 220.1 590.7 272 605.6 307.7C608.9 315.6 608.9 324.4 605.6 332.3C590.7 368 559.4 420 512.6 463.4C465.5 507.1 400.8 544 320 544C239.2 544 174.5 507.2 127.4 463.4C80.6 419.9 49.3 368 34.4 332.3C31.1 324.4 31.1 315.6 34.4 307.7C49.3 272 80.6 220 127.4 176.6zM320 400C364.2 400 400 364.2 400 320C400 290.4 383.9 264.5 360 250.7C358.6 310.4 310.4 358.6 250.7 360C264.5 383.9 290.4 400 320 400z"/></svg>
                        <svg v-if="appStore.droppedMarker.parent.value && appStore.droppedMarker.inIndex.value && subjectCollectionType(subject.id) === 5" class="is-dropped__archive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true"><title>抛弃</title><path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z"/></svg>
                        </template>
                      </strong>
                      <small class="index-subject__type">{{ indexItemTypeLabel(subject) }}</small>
                      <span v-if="subject.comment" class="index-subject__comment">{{ subject.comment }}</span>
                    </span>
                  </button>
                  <div v-if="canEditIndex && indexCanAddRelated && indexDetailMode === 'edit' && (!subject.kind || subject.kind === 'subject')" class="index-subject__actions">
                    <button class="secondary-button" type="button" @click="beginEditSubject(subject)">编辑</button>
                    <button class="secondary-button" type="button" @click="removeSubject(subject)">移除</button>
                  </div>
                  <form v-if="indexCanAddRelated && editingSubjectId === subject.id && (!subject.kind || subject.kind === 'subject')" class="index-subject__edit" @submit.prevent="saveSubject(subject.id)">
                    <input v-model="subjectEditForm.sort" class="onboarding__input" inputmode="numeric" placeholder="排序值（可选）" />
                    <input v-model="subjectEditForm.comment" class="onboarding__input" placeholder="备注" />
                    <button class="primary-button" type="submit" :disabled="subjectEditForm.submitting">保存</button>
                    <button class="secondary-button" type="button" @click="editingSubjectId = null">取消</button>
                  </form>
                </article>
                <p v-if="indexSubjects.length === 0" class="empty">目录中暂无条目。</p>
              </div>
              <Pager
                v-if="indexTotal > INDEX_PAGE_SIZE"
                :page-index="indexPage"
                :prev-disabled="indexOffset === 0"
                :next-disabled="indexLastPage"
                @prev="changeIndexPage(-1)"
                @next="changeIndexPage(1)"
              />
              <button
                v-show="showIndexBackToTop"
                class="detail-back-top"
                type="button"
                aria-label="回到目录详情顶部"
                @click="scrollIndexDetailToTop"
              >
                回到顶部
              </button>
            </section>
          </aside>
        </div>
      </Transition>
  </section>
</template>
