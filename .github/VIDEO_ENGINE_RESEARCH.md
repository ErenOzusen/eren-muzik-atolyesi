# Video Motoru Araştırması — 27.08.2026

## Amaç

İçerik hattının çekim planından sonra gerçek MP4 üretimine ilerlemesi için hazır açık kaynak motorları araştırmak. Kural: önce araştır, sonra 0-maliyet/dry-run, en son entegrasyon.

## Değerlendirme kriterleri

1. Onaylanmış senaryoyu değiştirmeden kullanabilme
2. Gerçek çekilmiş yerel videoyu kullanabilme
3. AI video / stock B-roll desteği
4. Altyazı, ses ve temel edit yetenekleri
5. CLI / API / Docker ile otomasyona bağlanabilme
6. Dry-run ve harcama limiti
7. Çoklu provider desteği ve vendor lock-in riski
8. Ticari kullanım lisansı
9. Proje güncelliği / bakım sinyali
10. İnsan onayı ve güvenlik kapılarıyla uyum

## Aday 1 — VibeFrame

Repo: https://github.com/vericontext/vibeframe

- MIT lisansı.
- CLI + MCP odaklı; GitHub Actions gibi dış ajanlar tarafından sürülmeye uygun.
- Seedance, Runway, Veo, Kling gibi video sağlayıcılarını destekliyor.
- `--dry-run` ile provider çağrısı yapmadan maliyet planı çıkarabiliyor.
- `--max-cost` ile sert harcama tavanı koyabiliyor.
- Mevcut yerel medya storyboard içinden doğrudan referans edilebiliyor ve provider harcaması gerektirmiyor.
- `edit silence-cut`, `edit noise-reduce`, `edit caption`, `remix auto-shorts` gibi gerçek çekim sonrası araçları var.
- JSON raporları, retry/nextActions ve agent-loop tasarımı bizim güvenlik/onay yaklaşımımıza çok uyumlu.
- Temmuz 2026'da v0.115.2 yayınlandı; proje aktif ama MoneyPrinterTurbo'ya göre daha yeni/küçük.

### En uygun kullanım

**Gerçek Eren çekimi → temizleme → kesme → altyazı → dikey Shorts/Reels → kalite kontrol → final MP4**

Ayrıca AI B-roll gerekiyorsa sahne bazlı üretim yapılabilir.

## Aday 2 — MoneyPrinterTurbo

Repo: https://github.com/harry0703/MoneyPrinterTurbo

- MIT lisansı.
- Çok olgun ve aktif proje; Ağustos 2026'da v1.3.5 yayınlandı.
- WebUI + API + CLI + Docker mevcut.
- `video_script` ile bizim hazır/onaylı senaryomuzu doğrudan kabul ediyor.
- `video_materials` ile yerel medya kullanılabiliyor.
- Pexels, Pixabay, Coverr ve AI-generated footage destekliyor.
- Çok sayıda LLM/TTS sağlayıcısı destekliyor.
- TikTok, Instagram ve YouTube Shorts yayınlama entegrasyonu var.
- V1 API için API-key authentication eklenmiş; ancak varsayılan olarak kapalı olabildiği için müşteri kurulumunda zorunlu güvenlik ayarı yapmamız gerekir.
- Bundled müzik konusunda README telif uyarısı yapıyor; müşteri ürününde yalnız lisansı açıkça uygun müzik kullanılmalı.
- VibeFrame kadar güçlü bir `dry-run + hard cost cap` mimarisi tespit edilmedi.

### En uygun kullanım

**Onaylı senaryo → stock/AI görüntü → TTS → altyazı → müzik → yüz göstermeden final kısa video**

## Aday 3 — OpenReels

Repo: https://github.com/tsensei/OpenReels

- MIT lisansı.
- Docker + REST API + CLI + Web UI.
- Araştırma → senaryo → voiceover → AI visuals → music → captions → Remotion assembly → critic zinciri hazır.
- Veo ve Kling gibi AI video sağlayıcıları, stock kaynaklar ve provider fallback desteği var.
- Dry-run ve maliyet tahmini mevcut.
- `--score` ile önceki DirectorScore üzerinden research/director aşamalarını atlayabiliyor.
- Bizim araştırma ve senaryo ajanlarımız zaten olduğu için tam pipeline'ı doğrudan kullanmak gereksiz tekrar yaratabilir.
- Nisan 2026'dan beri ana repo push aktivitesi sınırlı; daha yeni/küçük proje olduğu için ana bağımlılık olarak şimdilik daha temkinli yaklaşılmalı.

### En uygun kullanım

Daha sinematik, tamamen AI üretimli veya yüz göstermeyen özel videolar için alternatif motor.

## İlk karar

Tek bir video motoruna bağımlı olmayacağız.

### Yol A — HUMAN / HYBRID

`Onaylı senaryo → gerçek çekim → VibeFrame edit/remix → altyazı → final MP4`

Ana aday: **VibeFrame**

### Yol B — FACELESS / AI

`Onaylı senaryo → MoneyPrinterTurbo → stock veya AI footage → TTS → altyazı → final MP4`

Ana aday: **MoneyPrinterTurbo**

### Yol C — PREMIUM AI / ALTERNATİF

`Onaylı senaryo → OpenReels → daha sinematik AI pipeline`

Yedek/özel kullanım: **OpenReels**

## Mimari karar

Biz motorların içine iş mantığımızı gömmeyeceğiz. Kendi `Video Orchestrator` katmanımız şu kararı verecek:

- `human`: gerçek çekim yolu
- `hybrid`: gerçek çekim + AI B-roll
- `faceless`: stock/AI/TTS yolu
- `premium_ai`: daha pahalı sinematik AI üretim

Her motor bir adapter arkasında kalacak. Böylece ileride VibeFrame/MoneyPrinterTurbo/OpenReels değişse bile ana sistem bozulmayacak.

## Güvenlik / maliyet kuralı

- Gerçek para harcayan AI/video çağrısı kullanıcı onayı olmadan başlamaz.
- Mümkün olan her aşama önce dry-run / plan ile çalışır.
- Provider maliyeti ve tahmini toplam maliyet kullanıcıya gösterilir.
- Yayınlama final insan onayından sonra açılır.
- Harici motorların kendi araştırma/senaryo aşamaları, bizim onaylı senaryomuzu değiştirmemelidir.

## Bir sonraki test

**VibeFrame 0-key / dry-run uygunluk testi**:

1. Repodaki onaylı bir senaryodan küçük bir test proje girdisi üret.
2. Gerçek API key kullanmadan storyboard/scene formatını oluştur.
3. `vibe storyboard validate` / `vibe plan` / `vibe build --dry-run` benzeri hatları test et.
4. Harici AI/video çağrısı = 0.
5. Maliyet = 0.
6. Çıktı olarak yalnız plan, gerekli provider/key listesi ve tahmini maliyet alınır.

Bu test başarılı olursa ikinci test MoneyPrinterTurbo için yalnız yerel/custom-script doğrulaması olacak; yayınlama ve ücretli video üretimi kapalı kalacak.
