# AI Router — VS Code + GitHub Actions

Bu katman ajanları tek bir yapay zekâ sağlayıcısına bağımlı olmaktan çıkarır.

## Varsayılan sağlayıcı sırası

1. Anthropic
2. OpenAI
3. DeepSeek
4. Qwen

Bir sağlayıcının API anahtarı veya modeli yoksa router onu atlar. Limit, geçici API hatası veya kullanılabilir çıktı üretememe durumunda sıradaki sağlayıcıya geçer.

## Dosyalar

- `.github/config/ai-router.json` — provider ve fallback ayarları
- `.github/scripts/ai_router.py` — sağlayıcı bağımsız çağrı katmanı
- `.github/workflows/ai-router-smoke-test.yml` — güvenli test workflow'u

## GitHub Secrets

İhtiyaca göre şu secret'lar eklenebilir:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `DASHSCOPE_API_KEY`

API anahtarlarını hiçbir zaman repo dosyasına yazmayın.

## GitHub Variables

İsteğe bağlı model/endpoint değişkenleri:

- `OPENAI_MODEL`
- `DEEPSEEK_MODEL`
- `QWEN_MODEL`
- `QWEN_CHAT_ENDPOINT`

DeepSeek ve Qwen için config içinde güncel varsayılan modeller bulunur. OpenAI modeli özellikle değişken üzerinden seçilir; böylece model adı koddan bağımsız güncellenebilir.

## Güvenli test

Actions > `AI Router Smoke Test` > Run workflow

- `live_test=false`: 0 token. Sadece Python ve config doğrulanır.
- `live_test=true`: çok küçük bir gerçek çağrı yapılır ve kullanılabilir ilk provider test edilir.
- `provider_order`: ör. `deepseek,anthropic` yazarak belirli fallback sırası test edilebilir.

## VS Code'dan yerel kullanım

API anahtarlarını terminal oturumuna environment variable olarak verin. `.env` dosyaları `.gitignore` ile korunur.

Örnek:

```bash
export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."
export OPENAI_MODEL="<seçilen-model>"
export DEEPSEEK_API_KEY="..."
export DASHSCOPE_API_KEY="..."
```

Bir prompt dosyası oluşturup router'ı çalıştırın:

```bash
python3 .github/scripts/ai_router.py \
  --config .github/config/ai-router.json \
  --prompt-file /tmp/prompt.txt \
  --output-file /tmp/output.txt \
  --meta-file /tmp/meta.json \
  --max-tokens 1000 \
  --primary-model claude-sonnet-4-6
```

`/tmp/meta.json` hangi provider/modelin kullanıldığını ve token kullanımını gösterir.

## Geçiş durumu

Router'a taşınmış workflow'lar (hepsi kendi 0-token
`test_*_router_migration.mjs` testiyle doğrulandı):

- `filming-package-agent-v4-router.yml`
- `weekly-content-research.yml`
- `weekly-script-agent.yml`
- `weekly-script-correction.yml`
- `final-technical-check.yml`
- `editing-package-agent.yml`

**Router'a henüz taşınmadı (kasıtlı):** `weekly-quality-control.yml` —
Anthropic'in native `web_search` aracını kullanıyor, router bu aracı henüz
desteklemiyor; router web-search desteği kazanmadan taşınırsa web araması
sessizce kaybolur. Ayrıntı için `AI_ROUTER_MIGRATION_PLAN.md`.

Cost Guard (`.github/scripts/cost_guard.py`) yukarıdaki 6 router'lı yolun
hepsine takıldı: her birinde AI çağrısından önce config doğrulaması
(preflight) ve çağrıdan sonra gerçek token/deneme sayısı doğrulaması
(postflight) çalışır, sınır aşımında iş kapalı (fail-closed) durur.
