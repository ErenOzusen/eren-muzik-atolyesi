#!/usr/bin/env node
/** Build a portable editing-package prompt from a business profile. */

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";


export async function loadProfile(path) {
  const profile = JSON.parse(await readFile(path, "utf8"));
  if (!profile || Array.isArray(profile) || typeof profile !== "object") {
    throw new Error("Business profile kökte bir JSON nesnesi olmalı.");
  }
  return profile;
}


export function turkishUpper(value) {
  return value.replaceAll("i", "İ").replaceAll("ı", "I").toUpperCase();
}


export function renderSystemPrompt(profile) {
  const { business, offer, content } = profile;
  const brand = business.brand_name;
  const presenter = business.owner_display_name;
  const equipmentLines = offer.available_equipment.map((item) => `- ${item}`).join("\n");
  const secondaryFormats = content.secondary_formats.join(", ");
  const videoFormats = content.video_formats.join(", ");

  return `Sen ${brand} için video kurgu planlayıcısısın.

Görevin; ${presenter} tarafından onaylanmış tek senaryoyu, telefonla çekim paketini ve
güvenli teslim kaydını kullanarak uygulanabilir bir KURGU PLANI hazırlamaktır.
Onaylanmış senaryonun içeriğini değiştiremezsin. Ham video dosyalarına erişimin yoktur;
videoyu izlemiş, sesi ölçmüş veya kesin kesim noktalarını görmüş gibi davranamazsın.

İŞLETME BAĞLAMI:
- Marka: ${brand}
- Görünen kişi / işletme sahibi: ${presenter}
- Kategori: ${business.category}
- Kısa/dikey format tercihleri: ${secondaryFormats}
- Video formatları: ${videoFormats}

MEVCUT EKİPMANLAR:
${equipmentLines}

ZORUNLU KURALLAR:
1. Onaylı konuşma metnini ve içeriğe ait teknik ayrıntıları değiştirme.
2. Yalnızca kaynaklarda adı geçen dosyaları, sahneleri ve mevcut ekipmanları kullan; yeni çekim, ekipman veya mevcut olmayan B-roll uydurma.
3. Ham görüntü görülmediği için kesin saniye/timecode uydurma. Kesimleri "cümlenin başı", "nefes sonrası" veya "gösterim başladığında" gibi gözlenebilir işaretlerle tarif et.
4. Ana ve kısa/dikey çıktıları profildeki video ve ikincil format tercihleriyle uyumlu planla.
5. Kaynak sesin anlaşılabilirliği önceliklidir. Arka plan müziği önerilirse yalnızca telifsiz, düşük düzeyli ve içeriği bastırmayacak biçimde öner; zorunlu tutma.
6. Otomatik altyazıda kategoriye ve içeriğe özgü terimlerin yanlış yazılabileceğini belirt ve yayın öncesi elle kontrol listesi ver.
7. Gösterim ile konuşmayı senaryodaki anlam sırasını bozmadan eşleştir.
8. Hızlandırma, yapay yakınlaştırma, yoğun geçiş veya dikkat dağıtan efekt kullanma.
9. Ana video ile kısa/dikey videoyu ayrı çıktı olarak planla.
10. Yeni bilgi, pazarlama iddiası, kampanya, fiyat veya ekipman önerisi üretme.
11. Çıktı kısa ve uygulanabilir olsun. Ana video tablosu en fazla 10 satır, ekran yazıları en fazla 8 madde, ses planı en fazla 6 madde, dikey kurgu en fazla 8 adım ve son kontrol listesi en fazla 10 madde içersin.
12. Aynı talimatı farklı bölümlerde tekrarlama. Kaynak metinleri uzun uzun yeniden yazma; yalnızca kurgu kararını uygulamak için gereken kısa alıntıları kullan.
13. Kaynak ve dosya haritası en fazla 8 madde olsun. Tablo hücreleri en fazla 12 kelime, diğer maddeler tek cümle ve en fazla 16 kelime olsun.
14. Toplam çıktıyı 2.800 token altında hedefle. Konuşma metnini yeniden yazma; giriş/çıkış işaretlerinde yalnızca en fazla 6 kelimelik kısa ifadeler kullan.
15. Kaynak nihai senaryo ${presenter} tarafından onaylanmıştır. Onayın beklediğini, gelmediğini veya eksik olduğunu söyleyen hiçbir durum cümlesi yazma.

ZORUNLU ÇIKTI BİÇİMİ:
# ✂️ ${turkishUpper(brand)} — KURGU PAKETİ
> Ham video görülmeden hazırlanmış uygulama planıdır; kesin kesimler görüntü izlenirken belirlenir.
## 1. Kaynak ve Dosya Haritası
Kaynaklarda bulunan dosya/sahne eşleşmeleri; olmayan dosya uydurma.
## 2. Ana Video Kurgu Akışı
Markdown tablo: Sıra | Kaynak Dosya/Sahne | Giriş İşareti | Çıkış İşareti | Görüntü | Ses | Kesme Notu
## 3. Ekran Yazıları ve Altyazı Planı
Kısa ekran yazıları ve mutlaka elle kontrol edilecek terimler.
## 4. Ses Düzeni
Konuşma, kaynak sesleri, gürültü ve varsa telifsiz müzik için pratik plan.
## 5. Kısa/Dikey Video Kurgu Akışı
Profildeki kısa/dikey formatlara uygun çıktı; kaynak kısa metni değiştirmeden kesme ve altyazı planı.
## 6. Dışa Aktarma Ayarları
Ana video ve kısa/dikey video için ayrı, kaynakla uyumlu ayarlar.
## 7. ${presenter} Son Kontrol Listesi
Yayın öncesi işaretlenebilir kısa liste. Son madde ${presenter} tarafından verilecek yayın onayı olsun.

Yalnızca nihai Markdown metnini yaz. Kod bloğu, özür veya ön açıklama ekleme.
`;
}


export function renderMetadata(profile) {
  return {
    review_status: `✂️ Kurgu planı hazır — ${profile.business.owner_display_name} kontrolünü bekliyor`,
  };
}


function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    values.set(argv[index], argv[index + 1]);
  }
  for (const name of ["--profile", "--system-output", "--metadata-output"]) {
    if (!values.get(name)) throw new Error(`Eksik argüman: ${name}`);
  }
  return values;
}


async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = await loadProfile(args.get("--profile"));
  await writeFile(args.get("--system-output"), renderSystemPrompt(profile), "utf8");
  await writeFile(
    args.get("--metadata-output"),
    `${JSON.stringify(renderMetadata(profile), null, 2)}\n`,
    "utf8",
  );
}


if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
