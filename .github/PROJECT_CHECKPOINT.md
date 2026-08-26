# Proje Checkpoint — 26.08.2026

Devam komutu: **“Ben Eren kral devam edelim”**

## Ana hedef ve çalışma kuralı

Öncelik sırası:
1. Güvenilirlik
2. Kalite
3. Hız
4. Token tasarrufu

Gerçek AI harcaması kullanıcı kontrolü dışında başlamayacak. Yeni bağlantılar önce `test_mode=true` ve mümkün olduğunda 0 AI token ile doğrulanacak.

## Doğrulanmış ana akış

`QC → Düzeltme Ajanı → Nihai Senaryolar → Eren Onay Kapısı → Eren Senaryo Seçimi → Çekim Handoff Güvenlik Kapısı → Router'lı Çekim Paketi Ajanı`

### Eren kontrol komutları

- Onay: `ONAYLIYORUM`
- Test onay: `TEST ONAYLIYORUM`
- Senaryo seçimi: `SEÇ 1/2/3`
- Test seçim: `TEST SEÇ 1/2/3`
- Handoff testi: `TEST HANDOFF 1/2/3`
- Uçtan uca 0-token çekim testi: `TEST ÇEKİMİ BAŞLAT 1/2/3`
- Gerçek çekim paketi başlatma: `ÇEKİMİ BAŞLAT 1/2/3`

`ONAYLIYORUM` ve `SEÇ N` tek başına AI harcaması başlatmaz. Gerçek üretim ancak Eren ayrıca `ÇEKİMİ BAŞLAT N` dediğinde açılır.

## Güvenlik kapıları

### Onay Kapısı
Workflow: `.github/workflows/eren-approval-gate.yml`

- Yalnız doğru Nihai Senaryolar kayıtlarında çalışır.
- Merkezi profildeki yetkili GitHub sahibini doğrular.
- QC bağlantısını ve düzeltme durumunu kontrol eder.
- İlgisiz yorumlarda job `skipped` olur.

### Senaryo Seçim Kapısı
Workflow: `.github/workflows/eren-production-selection-gate.yml`

- Onay + çekime hazır durumunu zorunlu tutar.
- Tam bir `uretim-senaryo-N` etiketi üretir.
- Deterministik marker yazar:
  `<!-- FILMING_HANDOFF_V1 issue=N scenario=S -->`
- `SEÇ N` tek başına sonraki AI ajanını çalıştırmaz.

### Çekim Handoff Güvenlik Kapısı
Workflow: `.github/workflows/filming-handoff-gate.yml`

Gerçek üretimde şunları kontrol eder:
- exact Issue numarası
- exact senaryo
- Issue açık mı
- `eren-onayli + cekime-hazir + uretime-secildi`
- tam olarak bir `uretim-senaryo-N`
- `duzeltme-gerekiyor` yok
- `sistem-testi` değil
- komut senaryosu = etiket senaryosu
- exact `FILMING_HANDOFF_V1` marker

Bu kapı artık gerçek `ÇEKİMİ BAŞLAT N` komutunda Router'lı Çekim Paketi Ajanını çağırır.

Aktivasyon commit'i:
- `8449567b146f93bd20bec2bb8b9bd5ea061e9cf0` — gerçek handoff yolunu Router'lı v4 ajana bağladı.

## AI Router

Ana dosyalar:
- `.github/scripts/ai_router.py`
- `.github/config/ai-router.json`
- `.github/scripts/test_ai_router.py`
- `.github/workflows/ai-router-smoke-test.yml`

Varsayılan sağlayıcı sırası:

`Anthropic → OpenAI → DeepSeek → Qwen`

Mevcut davranış:
- API anahtarı/model eksik provider atlanır.
- API/network/limit/boş/truncated/filtered sonuç gibi kullanılmaz cevaplarda sonraki provider denenebilir.
- Anthropic ve OpenAI-style sağlayıcılarda system prompt ayrı korunur.
- Fallback sırasında harcanan toplam giriş/çıkış tokenları da meta veride toplanır.
- Canlı smoke test yalnız manuel `live_test=true` ile açılır.

Router system-prompt commit'i:
- `29ae3e35b73ee9599141c0c88497c2329675342a`

Router test genişletme commit'i:
- `651fd7bafd8467f09373bc7be2ef42aa0341c487`

## Router'lı Çekim Paketi Ajanı

Yeni workflow:
- `.github/workflows/filming-package-agent-v4-router.yml`
- Paket sürümü: `7`

Commit:
- `b4e3c24a7225cefdee1b482532a82230d751d29d`

Özellikler:
- Eski v3 dosyası geri dönüş/yedek olarak korunuyor.
- Varsayılan test modu gerçek AI çağrısı yapmaz.
- Exact Issue + exact senaryo güvenlikleri korunuyor.
- Yalnız seçilen tek senaryo ayıklanıyor.
- System prompt + user prompt ayrımı korunuyor.
- AI çağrısı doğrudan Claude curl yerine Router üzerinden yapılacak.
- Kazanan provider/model ve toplam token kullanımı kaydedilecek.
- Çıktı ancak kalite kontrollerini geçerse Issue olarak yayımlanacak.

### Doğrulanmış v4 0-token testi

Issue #37 / Senaryo 2 ile:
- Handoff Run #5: SUCCESS
- Router'lı Çekim Paketi Ajanı Run #1 — run id `33012564105`: SUCCESS
- Router/config yerel doğrulama: SUCCESS
- Seçilen senaryo ayıklama: SUCCESS
- Prompt hazırlama: SKIPPED
- AI Router canlı çağrısı: SKIPPED
- Issue/etiket yazma: SKIPPED
- AI tokenı: 0

Aktivasyon sonrası regresyon:
- Handoff Run #6 — run id `33012727716`: SUCCESS
- 0-token Router test dispatch: SUCCESS
- Gerçek Router'lı Çekim Paketi başlatma adımı testte beklendiği gibi SKIPPED

## Çıktı kalite sözleşmesi — yeni katman

Yeni dosyalar:
- `.github/scripts/output_contract.py`
- `.github/scripts/test_output_contract.py`
- `.github/config/contracts/filming-package.json`

Amaç:
Bir AI HTTP 200 ve dolu cevap verdi diye cevabı otomatik kabul etmemek. Çıktı; zorunlu başlıklar, bölüm sayısı, tablo yapısı, uzunluk ve yasak metinler açısından deterministik olarak kontrol edilecek.

Filming contract şu tür hataları reddeder:
- zorunlu altı bölümden biri eksik
- fazla/yanlış senaryo başlığı
- eski `onay bekleniyor` metni
- aşırı kısa/uzun çıktı
- zorunlu çekim tablosu yok

Commitler:
- `2fcee87ab1a51f9ef99794e5de7f3de81d4e8c46` — genel output contract doğrulayıcı
- `8d45feb12bdac4404fab89bece83a7384596b841` — çekim paketi kalite sözleşmesi
- `bf6c21a0c65129d8d67e3c20686b74b5afe45f7a` — kalite sözleşmesi 0-token testleri
- `0d2e2119b63070b94a2f8899ffd4cfcd037d978a` — smoke test entegrasyonu

Doğrulama:
- AI Router Smoke Test Run #4 — run id `33012888617`: SUCCESS
- Router + kalite sözleşmesi yerel testi: SUCCESS
- Canlı AI adımları: SKIPPED
- Harici AI isteği: 0
- AI tokenı: 0

## Şu anda tam olarak neredeyiz?

1. Ana içerik hattındaki Eren onayı/seçimi/handoff güvenlikleri çalışıyor.
2. Çekim Paketi Ajanının Router'lı v4 sürümü 0-token testten geçti ve gerçek handoff yolu v4'e bağlandı.
3. Çoklu sağlayıcı Router altyapısı var ve 0-token testleri geçiyor.
4. Çıktı kalite sözleşmesi var ve 0-token testleri geçiyor.
5. Henüz canlı provider fallback testi yapılmadı ve bu turda gerçek AI tokenı harcanmadı.

## Bir sonraki mantıklı adım

**Kalite sözleşmesini Router'ın gerçek provider döngüsüne bağlamak.**

Hedef davranış:

`Anthropic cevap verir → kalite sözleşmesi geçerse kabul`

Geçmezse:

`Anthropic çıktısı reddedilir → OpenAI denenir → o da geçmezse DeepSeek → sonra Qwen`

Böylece yalnız API/limit hatasında değil, **kalitesiz çıktıda da otomatik fallback** yapılacak.

Bu bağlantı da önce sahte çıktılarla 0-token test edilecek; canlı AI testi daha sonra ayrı karar olarak açılacak.
