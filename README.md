# ZİRVE HUB

Bağımlılıksız çalışan etkinlik yönetim uygulaması. Gerekenler: **Node.js 22.5 veya üstü**. `npm install` gerekmez.

## Çalıştırma
    node server.js
    # http://localhost:3000

İlk açılışta kurulum ekranı gelir: ilk yönetici (Süper Admin) hesabını sen oluşturursun.
Kodda hazır kullanıcı veya şifre yoktur. Diğer tüm hesapları yönetici panelinden oluşturursun.

## Ortam değişkenleri
- PORT: port (varsayılan 3000)
- DB: veritabanı dosyası (varsayılan ./zirve.db)
- SECURE=1: HTTPS arkasında çalışırken oturum çerezine Secure ekler

## Canlıya alırken
- Uygulamayı HTTPS arkasında (Nginx, Caddy vb.) çalıştır ve SECURE=1 ver.
- zirve.db dosyasını düzenli yedekle.
- Birden fazla sunucuya ölçeklemek için PostgreSQL'e geçiş gerekir (plan belgesine bak).

## Güvenlik özeti
- Şifreler scrypt + rastgele salt ile saklanır; oturum belirteçleri veritabanında yalnızca SHA-256 özeti olarak tutulur.
- Oturum: HttpOnly + SameSite=Lax çerez, 12 saat hareketsizlik süresi, çıkışta sunucuda silinir.
- Tüm yetki, kısıtlama ve belge uygunluğu kontrolleri sunucuda yapılır. Belge engeli ayrıca veritabanı tetikleyicisiyle korunur.
- Audit log tablosu veritabanı seviyesinde değiştirilemez (UPDATE/DELETE reddedilir).
- Girişte 5 hatalı denemeden sonra 5 dakika kilit, CSRF için özel başlık zorunluluğu, CSP başlıkları.
