# Proje Checkpoint — 26.08.2026

Devam komutu: **“Ben Eren kral devam edelim”**

Bu dosya, Eren Müzik Atölyesi çok ajanlı içerik otomasyonu projesinde kaldığımız güvenli noktayı kaydeder.

## Ana hedef

Öncelik sırası değişmedi:

1. Güvenilirlik
2. Kalite
3. Hız
4. Token tasarrufu

Üretim zinciri kullanıcı onayı olmadan AI harcaması başlatmayacak. Testler önce `test_mode=true` ve mümkün olduğunda 0 token ile yapılacak.

## Doğrulanmış ana akış

`QC → Düzeltme Ajanı → Nihai Senaryolar → Eren Onay Kapısı → Eren Senaryo Seçimi → Çekim Handoff Güvenlik Kapısı → Çekim Paketi Ajanı`

### 1. Eren Onay Kapısı

Workflow: `.github/workflows/eren-approval-gate.yml`

- Yalnız `Nihai Senaryolar` Issue'larında çalışıyor.
- Merkezi profilden yetkili GitHub sahibini ve onay komutunu okuyor.
- QC bağlantısını zorunlu tutuyor.
- `duzeltme-gerekiyor` varsa gerçek onayı reddediyor.
- `TEST ONAYLIYORUM` 0-token testidir ve Issue/etiket değiştirmez.
- 0-token test başarıyla geçti.
- Job filtresi yalnız `ONAYLIYORUM` veya `TEST ONAYLIYORUM` yorumlarında runner açıyor; ilgisiz yorumlar job başlamadan eleniyor.

### 2. Eski onay geçersizleştirme

Workflow: `.github/workflows/approval-invalidation-gate.yml`

- Nihai Issue gövdesi sonradan değişirse eski `eren-onayli`, `cekime-hazir`, `cekim-paketi-hazir` durumları kaldırılır.
- İçerik yeniden `eren-onayi-bekliyor` durumuna döner.
- Hiçbir sonraki ajan otomatik başlamaz.

### 3. Düzeltme Ajanı → Eren Onay Kapısı entegrasyonu

- Ayrı sistem test Issue'su ile 0-token handoff testi yapıldı.
- Onay Kapısı doğrulaması başarıyla geçti.
- Test gerçek üretime dokunmadan kapatıldı.

### 4. Eren Üretim Senaryosu Seçim Kapısı

Workflow: `.github/workflows/eren-production-selection-gate.yml`

Komutlar:
- `SEÇ 1/2/3`
- `TEST SEÇ 1/2/3`

Gerçek seçimde:
- `eren-onayli + cekime-hazir` zorunlu.
- `duzeltme-gerekiyor` varsa seçim yapılamaz.
- `uretime-secildi` ve tam bir `uretim-senaryo-N` etiketi kaydedilir.
- Yorum içine `<!-- FILMING_HANDOFF_V1 issue=N scenario=S -->` handoff işareti yazılır.
- `SEÇ N` tek başına Çekim Paketi Ajanını veya Claude'u başlatmaz.
- Job filtresi yalnız geçerli seçim komutlarında runner açar.
- 0-token seçim testi geçti.

### 5. Çekim Handoff Güvenlik Kapısı

Workflow: `.github/workflows/filming-handoff-gate.yml`

Test komutları:
- `TEST HANDOFF 1/2/3`: yalnız handoff doğrulaması, sonraki ajan başlamaz.
- `TEST ÇEKİMİ BAŞLAT 1/2/3`: handoff doğrulaması + Çekim Paketi Ajanına `test_mode=true` workflow dispatch.

Gerçek üretim komutları:
- `ÇEKİMİ BAŞLAT 1/2/3`

Güvenlikler:
- Yalnız merkezi profildeki yetkili GitHub sahibi komut verebilir.
- Exact Issue numarası ve senaryo çözülür.
- Hedef mutlaka `Nihai Senaryolar` olmalıdır.
- Testte yalnız `sistem-testi` kabul edilir.
- Gerçek modda Issue açık olmalı; `eren-onayli + cekime-hazir + uretime-secildi` zorunludur.
- `duzeltme-gerekiyor` gerçek aktarımı bloklar.
- Tam olarak bir `uretim-senaryo-1/2/3` etiketi gerekir.
- Komuttaki senaryo, etiket ve `FILMING_HANDOFF_V1` marker birebir uyuşmalıdır.
- `TEST ÇEKİMİ BAŞLAT N`, gerçek Claude çağrısı açmadan dispatch hattını test eder.
- `ÇEKİMİ BAŞLAT N`, yalnız bütün gerçek üretim kontrolleri geçerse exact Issue + exact senaryo ile Çekim Paketi Ajanını başlatır.

### 6. Çekim Paketi Ajanı — deterministik kaynak devralma

Workflow: `.github/workflows/filming-package-agent-v3.yml.yml`
Paket sürümü: `6`

- Varsayılan `test_mode=true`.
- Test modunda Claude/API, Issue oluşturma ve etiket değişikliği yok.
- Gerçek üretimde artık 'en güncel uygun Issue' aranmaz.
- `source_issue_number` ve `source_scenario` zorunludur.
- Exact kaynak Issue + açık state + güvenlik etiketleri + tek seçim etiketi + handoff marker doğrulanır.
- Yalnız seçilmiş tek senaryo Python ile deterministik ayıklanır.
- Yalnız bu tek senaryo modele gider.
- Aynı kaynak gövde + paket sürümü + senaryo için güncel paket varsa AI yeniden çağrılmaz.

## Doğrulanmış 0-token çekim testleri

### A. Yerel Çekim Paketi testi
Run #3:
- SUCCESS
- `TEST_MODE=true`, senaryo 2
- Senaryo ayıklama başarılı
- Claude/API: skipped
- Issue/etiket yazma: skipped
- 0 AI token

### B. Handoff regresyon testi
Issue #37 / senaryo 2:
- `TEST HANDOFF 2`
- Handoff Run #1: SUCCESS
- Handoff Run #2: SUCCESS
- Gerçek Çekim Paketi dispatch adımı testte skipped
- 0 AI token

### C. Uçtan uca workflow_dispatch testi — TAMAMLANDI
Komut: `TEST ÇEKİMİ BAŞLAT 2`
Kaynak: sistem testi Issue #37

Sonuç:
- Handoff Kapısı başarılı oldu.
- Handoff Kapısı, Çekim Paketi Ajanını `test_mode=true`, `test_issue_number=37`, `test_scenario=2` ile gerçekten workflow_dispatch üzerinden başlattı.
- Çekim Paketi Ajanı Run #4 — run id `33011714337`: SUCCESS.
- `Seçilmiş nihai senaryoyu güvenli biçimde bul ve ayıkla`: SUCCESS.
- `Tek senaryoluk telefonla çekim isteğini hazırla`: SKIPPED.
- `Tek senaryoluk çekim paketini oluştur ve doğrula` / Anthropic API: SKIPPED.
- `Çekim paketini Issue olarak kaydet`: SKIPPED.
- Eski paket kontrol/yazma adımı: SKIPPED.
- Gerçek Issue/etiket değişikliği: yok.
- AI maliyeti: 0 token.

Bu test ile `Eren komutu → Handoff Kapısı → workflow_dispatch → Çekim Paketi Ajanı → güvenli test-mode ayıklama` sözleşmesi uçtan uca doğrulandı.

## Yeni gerçek üretim akışı

`3 Nihai Senaryo`
→ Eren `ONAYLIYORUM`
→ Eren `SEÇ N`
→ seçim etiketi + handoff marker
→ Eren `ÇEKİMİ BAŞLAT N`
→ Handoff Kapısı exact Issue + exact senaryoyu doğrular
→ Çekim Paketi Ajanı exact girdilerle başlar
→ yalnız seçilen tek senaryo modele gönderilir
→ yalnız burada gerektiğinde Claude çağrısı yapılır

Önemli: `ONAYLIYORUM` ve `SEÇ N` AI harcaması başlatmaz. AI harcaması ancak Eren açıkça `ÇEKİMİ BAŞLAT N` dediğinde ve bütün güvenlik kontrolleri geçtiğinde açılır.

## Bu turdaki önemli commitler

- `72401500ce45231864d2d35cb69d8d1ce44e2705` — deterministik seçim handoff marker
- `733beee50f95dc197aa659eb7644abd8757e412e` — Çekim Paketi Ajanında exact Issue/senaryo zorunluluğu
- `4064963413197ff47d0429b1efec2762c00786c5` — explicit `ÇEKİMİ BAŞLAT N` kapısı
- `75f4814a33e1c70a26e09bd989f7ec518546c7b3` — Onay Kapısı ilgisiz yorum filtresi
- `1f03eb63aecf297b37b15936621048992a3dc4ef` — Seçim Kapısı ilgisiz yorum filtresi
- `e6ccb65132d1633ca439786f2422cce88c42a95d` — `TEST ÇEKİMİ BAŞLAT N` 0-token workflow_dispatch test yolu

## Tam burada durduk

**Çekim hattının deterministik, kontrollü ve 0-token test edilebilir devralma/dispatch mimarisi tamamlandı.**

Bir sonraki mantıklı aşama:

**Mevcut `.github/workflows/ai-router-smoke-test.yml` ve ilgili router yapılarını inceleyip, mevcut güvenlik kapılarını bozmadan çoklu AI provider/fallback katmanını önce 0-token konfigürasyon testiyle doğrulamak.**
