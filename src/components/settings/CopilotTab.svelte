<script lang="ts">
  import { copilotInit, copilotAuthStatus, copilotListModels, copilotStop, type CopilotAuthStatus, type CopilotModel } from "../../lib/copilotStore";

  let copilotAuth = $state<CopilotAuthStatus | null>(null);
  let copilotModels = $state<CopilotModel[]>([]);
  let copilotLoading = $state(false);
  let copilotError = $state("");
  let copilotInitialized = $state(false);
  let copilotNeedsCli = $state(false);
  let copilotNeedsLogin = $state(false);
</script>

<div class="section">
  <h2>GitHub Copilot</h2>
  <p class="hint">Optimize your voice transcriptions into better prompts using GitHub Copilot.</p>

  {#if copilotError}
    <div class="message error" style="margin-bottom: 12px;">{copilotError}</div>
  {/if}

  {#if copilotLoading}
    <p class="hint">Connecting...</p>
  {:else if copilotNeedsCli}
    <div class="info-box">
      <strong>GitHub Copilot CLI not found</strong>
      <p style="margin-top: 8px;">The GitHub Copilot CLI is required to use this feature. To install it:</p>
      <ol style="margin: 8px 0 0 20px; line-height: 1.8;">
        <li>Run <code>winget install GitHub.Copilot</code> (Windows) or see <a href="https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli" target="_blank" rel="noopener">install docs</a></li>
        <li>Restart your terminal so <code>copilot</code> is on your PATH</li>
        <li>Come back here and click <strong>Retry</strong></li>
      </ol>
    </div>
    <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={() => { copilotNeedsCli = false; copilotError = ''; }}>Retry</button>
  {:else if copilotNeedsLogin}
    <div class="info-box">
      <strong>Not signed in to GitHub Copilot</strong>
      <p style="margin-top: 8px;">You need to authenticate with GitHub. Open a terminal and run:</p>
      <pre style="margin: 8px 0; padding: 8px 12px; background: var(--bg-primary); border-radius: 6px; font-size: 0.9em;">copilot auth login</pre>
      <p>Follow the prompts to sign in with your GitHub account, then click <strong>Retry</strong> below.</p>
    </div>
    <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={async () => {
      copilotLoading = true; copilotError = ''; copilotNeedsLogin = false;
      try {
        copilotAuth = await copilotAuthStatus();
        if (copilotAuth?.authenticated) { copilotModels = await copilotListModels(); }
        else { copilotNeedsLogin = true; }
      } catch (e: any) { copilotError = String(e); copilotNeedsLogin = true; }
      finally { copilotLoading = false; }
    }}>Retry</button>
  {:else if !copilotInitialized}
    <button type="button" class="toggle-btn" onclick={async () => {
      copilotLoading = true; copilotError = ''; copilotNeedsCli = false; copilotNeedsLogin = false;
      try {
        await copilotInit(); copilotInitialized = true;
        copilotAuth = await copilotAuthStatus();
        if (copilotAuth?.authenticated) { copilotModels = await copilotListModels(); }
        else { copilotNeedsLogin = true; }
      } catch (e: any) {
        copilotInitialized = false;
        const msg = String(e); const msgLower = msg.toLowerCase();
        if (msgLower.includes('not found') || msgLower.includes('no such file') || msgLower.includes('os error 2') || msgLower.includes('program not found')) { copilotNeedsCli = true; }
        else { copilotError = msg; }
      } finally { copilotLoading = false; }
    }}>Connect to GitHub Copilot</button>
  {:else}
    <div class="info-box" style="border-color: var(--accent-primary); display: flex; align-items: center; gap: 12px;">
      {#if copilotAuth?.login}
        <img src="https://github.com/{copilotAuth.login}.png?size=80" alt="{copilotAuth.login}" style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;" />
      {/if}
      <p>Signed in as <strong>{copilotAuth?.login ?? 'unknown'}</strong></p>
    </div>

    {#if copilotModels.length > 0}
      <h3 style="margin-top: 16px; margin-bottom: 8px;">Available Models</h3>
      <div class="model-list">
        {#each copilotModels as model}
          <div class="model-card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>{model.name}</strong>
              {#if model.is_premium}
                <span class="multiplier-badge" class:multiplier-high={model.multiplier > 1} class:multiplier-low={model.multiplier < 1}>{model.multiplier}x</span>
              {:else}
                <span class="multiplier-badge multiplier-free">Included</span>
              {/if}
            </div>
            <span class="hint">{model.id}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="hint" style="margin-top: 12px;">No models available.</p>
    {/if}

    <div style="margin-top: 16px; display: flex; gap: 8px;">
      <button type="button" class="toggle-btn" onclick={async () => {
        copilotLoading = true; copilotError = '';
        try { copilotModels = await copilotListModels(); } catch (e: any) { copilotError = String(e); }
        finally { copilotLoading = false; }
      }}>Refresh Models</button>
      <button type="button" class="toggle-btn" onclick={async () => {
        copilotLoading = true;
        try { await copilotStop(); copilotInitialized = false; copilotAuth = null; copilotModels = []; copilotNeedsLogin = false; }
        catch (e: any) { copilotError = String(e); } finally { copilotLoading = false; }
      }}>Disconnect</button>
    </div>
  {/if}
</div>
