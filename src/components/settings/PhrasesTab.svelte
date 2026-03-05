<script lang="ts">
  let {
    phraseList = $bindable(),
  }: {
    phraseList: string[];
  } = $props();

  let newPhrase = $state("");

  function addPhrase() {
    const trimmed = newPhrase.trim();
    if (trimmed && !phraseList.includes(trimmed)) {
      phraseList = [...phraseList, trimmed];
    }
    newPhrase = "";
  }

  function removePhrase(phrase: string) {
    phraseList = phraseList.filter((p) => p !== phrase);
  }
</script>

<div class="section">
  <h2>Phrase List</h2>
  <p class="section-note">Phrase lists improve recognition accuracy for <strong>Azure Speech</strong> (boost) and <strong>Whisper</strong> (initial prompt). They are not used with Web Speech.</p>

  <div class="field">
    <span class="label">Custom Phrases ({phraseList.length})</span>
    <div class="input-row">
      <input type="text" bind:value={newPhrase} placeholder="Add a word or phrase..."
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhrase(); } }} />
      <button type="button" class="toggle-btn" onclick={addPhrase}>Add</button>
    </div>
    {#if phraseList.length > 0}
      <div class="phrase-tags">
        {#each phraseList as phrase}
          <span class="phrase-tag">
            {phrase}
            <button type="button" class="phrase-remove" onclick={() => removePhrase(phrase)}>✕</button>
          </span>
        {/each}
      </div>
    {/if}
    <span class="hint">Add words or phrases to improve recognition accuracy (e.g. technical terms, names, project-specific vocabulary).</span>
  </div>
</div>
