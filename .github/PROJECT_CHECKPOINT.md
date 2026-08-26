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
- Job filtresi artık yalnız `ONAYLIYORUM` veya `TEST ONAYLIYORUM` yorumlarında runner açıyor; ilgisiz yorumlar job başlamadan eleniyor.

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

Amaç: Düzeltme Ajanı 3 nihai senaryo ürettiği için Çekim Paketi Ajanının hangi senaryoyu kullanacağını tahmin etmesini engellemek.

Komutlar:

- `SEÇ 1`
- `SEÇ 2`
- `SEÇ 3`
- Test için: `TEST SEÇ 1/2/3`

Gerçek seçimde:

- Önce `eren-onayli + cekime-hazir` zorunlu.
- `duzeltme-gerekiyor` varsa seçim yapılamaz.
- Seçim `uretime-secildi` ve tam bir `uretim-senaryo-N` etiketiyle kaydedilir.
- Yorum içine deterministik handoff işareti yazılır:
  `<!-- FILMING_HANDOFF_V1 issue=N scenario=S -->`
- Böylece kaynak Issue numarası ve senaryo birbirine kriptografik olmayan ama açık ve deterministik bir sözleşmeyle bağlanır.
- `SEÇ N` tek başına Çekim Paketi Ajanını veya Claude'u başlatmaz.
- Job filtresi artık yalnız geçerli `SEÇ N / TEST SEÇ N` yorumlarında runner açıyor.
- 0-token seçim kapısı testi başarıyla geçti.

### 5. Çekim Handoff Güvenlik Kapısı

Workflow: `.github/workflows/filming-handoff-gate.yml`

Amaç: Eren'in seçtiği senaryonun yanlış Issue veya yanlış senaryo ile Çekim Paketi Ajanına aktarılmasını engellemek.

Test komutu:

- `TEST HANDOFF 1/2/3`

Gerçek üretim başlatma komutu:

- `ÇEKİMİ BAŞLAT 1`
- `ÇEKİMİ BAŞLAT 2`
- `ÇEKİMİ BAŞLAT 3`

Güvenlikler:

- Yalnız merkezi profildeki yetkili GitHub sahibi yorum komutu verebilir.
- Issue numarası ve beklenen senaryo açıkça çözülür.
- Hedef Issue mutlaka `Nihai Senaryolar` olmalıdır.
- Beklenen senaryo başlığı kaynak Issue içinde bulunmalıdır.
- Test modunda yalnız `sistem-testi` kabul edilir.
- Test modunda AI çağrısı, Issue/etiket değişikliği veya sonraki ajan tetikleme yoktur.
- Gerçek modda Issue açık olmalıdır.
- `sistem-testi` gerçek üretime giremez.
- `eren-onayli + cekime-hazir + uretime-secildi` zorunludur.
- `duzeltme-gerekiyor` varsa aktarım reddedilir.
- Tam olarak bir `uretim-senaryo-1/2/3` etiketi zorunludur.
- Komuttaki senaryo ile etiket senaryosu birebir eşleşmelidir.
- Seçim Kapısının `FILMING_HANDOFF_V1` işareti zorunludur.
- Yalnız tüm kontroller geçip Eren ayrıca `ÇEKİMİ BAŞLAT N` dediğinde Çekim Paketi Ajanı exact Issue + exact senaryo girdileriyle dispatch edilir.

Doğrulanmış testler:

- Issue #37 / Senaryo 2 ile `TEST HANDOFF 2` çalıştırıldı.
- Handoff Run #1: SUCCESS.
- Yeni explicit-start mantığı sonrasında Handoff Run #2: SUCCESS.
- Run #2'de `Çekim Paketi Ajanını kesin handoff ile başlat` adımı beklendiği gibi `skipped`.
- AI kullanımı: 0 token.
- Gerçek üretim: yok.

### 6. Çekim Paketi Ajanı — deterministik kaynak devralma

Workflow: `.github/workflows/filming-package-agent-v3.yml.yml`

Paket sürümü: `6`

Güncel güvenlikler:

- Varsayılan `test_mode=true`.
- Test modunda Claude/API çağrısı yok.
- Test modunda gerçek Issue veya etiket değişikliği yok.
- Gerçek üretimde artık 'en güncel uygun Issue' aranmaz.
- Gerçek üretimde `source_issue_number` zorunludur.
- Gerçek üretimde `source_scenario` zorunludur.
- Exact kaynak Issue açılır ve doğrulanır.
- Issue açık olmalıdır.
- `eren-onayli + cekime-hazir + uretime-secildi` zorunludur.
- Tam olarak bir `uretim-senaryo-1/2/3` etiketi zorunludur.
- Input senaryo ile etiket senaryosu eşleşmek zorundadır.
- `sistem-testi` gerçek üretim kaynağı olamaz.
- `duzeltme-gerekiyor` varsa durur.
- Kaynak Issue yorumlarında exact `FILMING_HANDOFF_V1 issue=N scenario=S` işareti zorunludur.
- 3 senaryolu Nihai Issue'dan yalnız seçilen tek senaryo Python ile deterministik olarak ayıklanır.
- Yalnız bu tek senaryo modele gönderilir; gereksiz token tüketimi önlenir.
- Aynı kaynak gövde + paket sürümü + senaryo için güncel paket zaten varsa yeniden AI çağrısı yapılmaz.

### 7. Eski Çekim Paketi 0-token testi

Önceki Run #3:

- `SUCCESS`
- `TEST_MODE=true`
- `TEST_SCENARIO=2`
- Seçilen senaryo deterministik olarak doğru ayıklandı.
- Claude isteği hazırlama: skipped
- Claude/API çağrısı: skipped
- Issue oluşturma: skipped
- Gerçek etiket değişikliği: yok
- AI maliyeti: 0 token
- Web araması: 0

## Mevcut eski gerçek kayıt

Issue #22 eski sistemden gelen tek senaryolu gerçek Nihai Senaryo kaydıdır.
Onun Çekim Paketi #23 zaten daha önce oluşturulmuştur.
Bu kayıt tekrar çalıştırılmayacak; gereksiz token harcanmayacak.

## Yeni gerçek üretim akışı

`3 Nihai Senaryo`
→ Eren `ONAYLIYORUM`
→ Eren `SEÇ 1 / SEÇ 2 / SEÇ 3`
→ seçim etiketi + handoff marker
→ Eren `ÇEKİMİ BAŞLAT 1 / 2 / 3`
→ Handoff Kapısı exact Issue + exact senaryoyu doğrular
→ yalnız seçilen tek senaryo
→ Çekim Paketi Ajanı
→ yalnız burada gerekli olduğunda Claude çağrısı

Önemli: `SEÇ N` AI harcaması başlatmaz. Gerçek Çekim Paketi AI çağrısı ancak Eren ayrıca `ÇEKİMİ BAŞLAT N` komutunu verdiğinde açılır.

## Bu turdaki commitler

- `72401500ce45231864d2d35cb69d8d1ce44e2705` — deterministik seçim handoff marker
- `ac480bbc05fe13a62385a732fa50074280c9cab4` — 0-token handoff test komutu
- `733beee50f95dc197aa659eb7644abd8757e412e` — Çekim Paketi Ajanında exact Issue/senaryo zorunluluğu
- `4064963413197ff47d0429b1efec2762c00786c5` — explicit `ÇEKİMİ BAŞLAT N` kapısı
- `75f4814a33e1c70a26e09bd989f7ec518546c7b3` — Onay Kapısında ilgisiz yorumları job öncesi eleme
- `1f03eb63aecf297b37b15936621048992a3dc4ef` — Seçim Kapısında ilgisiz yorumları job öncesi eleme

## Tam burada durduk

Çekim hattının güvenli devralma mimarisi tamamlandı ve 0-token regresyon testi geçti.

Bir sonraki mantıklı adım:

**Gerçek AI çağrısı yapmadan, `ÇEKİMİ BAŞLAT N → workflow_dispatch → Çekim Paketi Ajanı` dispatch sözleşmesini dry-run/test modunda uçtan uca doğrulayacak bir test yolu eklemek.**

Bunun ardından çoklu AI Router / provider fallback mimarisi, mevcut güvenlik kapılarını bozmadan entegre edilebilir.
