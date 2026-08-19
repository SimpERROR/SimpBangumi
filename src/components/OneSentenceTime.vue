<script setup lang="ts">
import { computed, ref } from "vue";
import { ONE_SENTENCE_CORPUS } from "../data/oneSentenceCorpus";

function createShuffledIndexes(previousIndex?: number): number[] {
  const indexes = Array.from(ONE_SENTENCE_CORPUS, (_, index) => index);

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  if (previousIndex !== undefined && indexes.length > 1 && indexes[indexes.length - 1] === previousIndex) {
    [indexes[indexes.length - 1], indexes[indexes.length - 2]] = [indexes[indexes.length - 2], indexes[indexes.length - 1]];
  }

  return indexes;
}

let remainingSentenceIndexes = createShuffledIndexes();
const sentenceIndex = ref(remainingSentenceIndexes.pop() ?? 0);
const changeAnimationKey = ref(0);
const sentence = computed(() => ONE_SENTENCE_CORPUS[sentenceIndex.value]);
const sentenceCharacters = computed(() => [...sentence.value.text]);

function changeSentence() {
  if (remainingSentenceIndexes.length === 0) {
    remainingSentenceIndexes = createShuffledIndexes(sentenceIndex.value);
  }
  sentenceIndex.value = remainingSentenceIndexes.pop() ?? sentenceIndex.value;
  changeAnimationKey.value += 1;
}
</script>

<template>
  <section class="one-sentence-time" aria-labelledby="one-sentence-time-title">
    <div class="one-sentence-time__header">
      <div>
        <h2 id="one-sentence-time-title">一句话时间</h2>
      </div>
      <button
        class="icon-button one-sentence-time__change"
        type="button"
        title="换一句"
        aria-label="换一句"
        @click="changeSentence"
      >
        <svg :key="changeAnimationKey" class="one-sentence-time__change-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 11a8 8 0 0 0-14.9-4L3 9m0-5v5h5M4 13a8 8 0 0 0 14.9 4L21 15m0 5v-5h-5" />
        </svg>
      </button>
    </div>
    <div class="one-sentence-time__quote-frame">
      <span class="one-sentence-time__quote one-sentence-time__quote--open" aria-hidden="true">“</span>
      <Transition name="one-sentence-time-text" mode="out-in">
        <p :key="sentenceIndex" class="one-sentence-time__content">
          <span
            v-for="(character, index) in sentenceCharacters"
            :key="`${sentenceIndex}-${index}`"
            class="one-sentence-time__character"
            :style="{ animationDelay: `${index * 18}ms` }"
          >{{ character }}</span>
        </p>
      </Transition>
      <Transition name="one-sentence-time-source" mode="out-in">
        <p :key="sentence.source" class="one-sentence-time__source">{{ sentence.source }}</p>
      </Transition>
      <span class="one-sentence-time__quote one-sentence-time__quote--close" aria-hidden="true">”</span>
    </div>
  </section>
</template>