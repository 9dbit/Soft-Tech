# Tindakan manusia untuk enrollment dan persetujuan go-live

Dokumen ini menyiapkan langkah yang dapat dijalankan oleh pemilik dan reviewer yang sebenarnya. Dokumen ini tidak mendaftarkan identitas, menyatakan sertifikasi operator, atau memberikan persetujuan. Akun fixture dalam pengujian tidak dapat dipakai sebagai bukti gate. Status akhir harus berasal dari hasil lingkungan live dan keputusan pihak yang berwenang.

## Panel dan bukti lingkungan

Alamat berikut berasal dari inventaris resource proyek `evidence/physical-isolation-resources-2026-11-10.json`. Buka `/health` untuk memeriksa identitas dan commit yang benar-benar terpasang sebelum melakukan tindakan; nama domain lama yang berakhiran `production` tidak menentukan lingkungan aplikasi.

| Lingkungan aplikasi | Panel | Pemeriksaan publik |
| --- | --- | --- |
| Sandbox | https://soft-tech-provider-panel.up.railway.app/ | `/health`, `/health/backup` |
| Preproduction | https://softtech-preprod-core-preproduction.up.railway.app/ | `/health`, `/health/backup` |
| Production yang dikarantina | https://softtech-prod-core-production.up.railway.app/ | `/health`, `/health/backup` |

Akun, password, authenticator, recovery code dan sesi harus dibuat terpisah pada setiap lingkungan. Gunakan identitas personel yang benar dan konsisten untuk satu orang. Jangan menyalin database staf atau sesi dari sandbox untuk mengisi preproduction/production.

## 1. Pemilik sebenarnya mendaftarkan akun pertama

1. Pastikan `/api/session` menunjukkan lingkungan yang dimaksud dan `staff_bootstrap_available:true`. Bila sudah `false`, gunakan **Individual Staff + MFA**; jangan mencoba membuka kembali bootstrap.
2. Pada panel lingkungan tersebut, pemilik yang berwenang memilih **Shared Sandbox Administrator** dan masuk dengan kredensial bootstrap lingkungan dari penyimpanan rahasia yang disetujui. Label UI tersebut masih dipakai untuk pintu bootstrap awal di preproduction/production. Akses bersama di luar sandbox tidak dapat mengubah operator atau menyetujui rilis.
3. Buka **Staff & MFA → ENROLL FIRST OWNER**. Isi username pribadi, nama sebenarnya, referensi personel/work email yang unik, password pribadi baru sepanjang 16–128 karakter, dan konfirmasi password administrator bootstrap. Pemilik memasukkan sendiri rahasianya; jangan menaruhnya dalam laporan atau percakapan.
4. Masukkan setup key yang ditampilkan ke authenticator milik pemilik: TOTP, enam digit, periode 30 detik. Masukkan satu kode yang valid pada **CONFIRM ENROLLMENT**. Enrollment berlaku sepuluh menit dan baru mengaktifkan akun setelah konfirmasi tersebut.
5. Simpan delapan recovery code yang ditampilkan sekali ke penyimpanan pribadi yang disetujui, lalu tutup dialog. Recovery code memberi akses terbatas untuk mengganti authenticator; kode itu tidak dapat dipakai untuk menyetujui rilis.
6. Keluar dan masuk kembali melalui **Individual Staff + MFA** dengan password pribadi dan kode authenticator baru. Pastikan identitas yang ditampilkan benar.

Bootstrap ditutup ketika pendaftaran pertama tercatat, meskipun konfirmasi MFA belum selesai. Jika dialog tertutup atau proses terputus, masuk dengan username/password pribadi yang baru dipilih untuk menerima enrollment baru. Di preproduction/production, cookie bersama yang sudah ada juga ditolak sejak pendaftaran pertama. Kehilangan password akun pending tidak membuka bootstrap kembali secara otomatis.

Endpoint yang menjalankan langkah ini: `POST /api/login`, `POST /api/staff/bootstrap`, `POST /api/staff/enroll/confirm`, `POST /api/staff/login`, `POST /api/staff/mfa`. Tindakan autentikasi dan status akun dicatat tanpa menyimpan kode/secret dalam audit.

## 2. Undang orang yang berbeda untuk pengajuan dan persetujuan

Pemilik membuka **Staff & MFA → INVITE STAFF**, mengisi data orang yang benar dan memilih hak minimum yang sesuai. Token undangan berlaku 24 jam dan harus disampaikan sendiri melalui kanal privat yang disetujui. Penerima membuka **ACTIVATE STAFF INVITATION** pada halaman login, memasukkan token, memilih password sendiri, lalu menyelesaikan enrollment authenticator sendiri. Tidak ada pengiriman email otomatis.

| Role panel | Wewenang |
| --- | --- |
| `owner` | Mengelola staf dan operasi; meminta, memvalidasi, menyetujui, mengaktifkan, menolak atau membatalkan rilis sesuai pemisahan orang |
| `operator` | Mengelola operasi; meminta, memvalidasi, mengaktifkan atau membatalkan rilis |
| `approver` | Menyetujui atau menolak rilis; tidak mengubah operasi |
| `auditor` | Membaca laporan dan mengelola kredensial sendiri |

Setidaknya satu requester (`owner` atau `operator`) dan satu approver (`owner` atau `approver`) harus merupakan dua manusia yang berbeda. Pemilik dapat menjadi requester, tetapi tidak dapat menyetujui permintaannya sendiri. Membuat dua akun untuk satu orang tidak memenuhi syarat. `person_ref` yang unik membantu penegakan aplikasi; verifikasi manusia atas identitas tetap wajib.

Verifikasi `GET /api/staff` dan `GET /api/release-control` setelah login: status setiap akun yang diperlukan `active`, `mfa_enrolled:true`, jumlah staf MFA yang relevan benar, dan `distinct_approvers_available:true`. `human_identity_review_required:true` tetap tampil karena sistem tidak membuktikan identitas dunia nyata hanya dari akun. Reviewer keamanan harus memetakan `staff_id`, `person_ref` dan penanggung jawab nyata dalam bukti yang dilindungi; jangan memasukkan password, setup key, token undangan atau recovery code.

Sensitivitas pengelolaan staf dan rilis membutuhkan MFA TOTP yang diverifikasi dalam sepuluh menit terakhir. Bila diperlukan, gunakan **VERIFY NEW MFA CODE** sebelum tindakan. Kode yang sudah diterima tidak dapat dipakai ulang; tunggu kode baru. Revokasi sesi, perubahan password atau perubahan role membatalkan otoritas rilis pending yang terkait.

## 3. Rilis operator/game ke preproduction

Ini adalah alur persetujuan operator/game yang tersedia sekarang. Alur ini tidak mengaktifkan production.

1. Requester memastikan identitas lingkungan, backup yang telah dipulihkan untuk verifikasi, pemisahan resource dan kondisi game/operator siap. Bila mode global perlu diubah, requester dengan hak operasi dan `release:activate` memilih preproduction dan memasukkan `CONFIRM PREPRODUCTION`.
2. Requester membuat permintaan untuk operator eksternal yang dikonfigurasi dan game tertentu melalui panel Release atau `POST /api/release-requests` dengan `operator_id`, `game_id`, `mode:"preproduction"`.
3. Requester/validator melakukan `POST /api/release-requests/<id>/validate`. Status menjadi `validated` setelah pemeriksaan aplikasi berhasil.
4. Approver yang berbeda login dengan akun dan authenticator sendiri, memeriksa operator/game/mode serta bukti yang relevan, lalu menjalankan `POST /api/release-requests/<id>/approve`. ID/person reference yang sama dengan requester ditolak.
5. Orang dengan role `owner`/`operator` mengaktifkan permintaan melalui `POST /api/release-requests/<id>/activate`. Aplikasi memeriksa ulang identitas requester, approver, versi kredensial, role dan pemisahan orang. Simpan ID permintaan dan audit `release.requested`, `release.validate`, `release.approve`, `release.activate` sebagai bukti.

Shared login dan sesi recovery tidak dapat memenuhi langkah rilis ini. Operator qualification internal tidak menjadi operator eksternal tersertifikasi. Mode `production` tetap ditolak oleh endpoint; health dan release-control tetap menyatakan `production_enabled:false`.

## 4. Gate proyek dan reviewer yang harus benar-benar bertindak

Verifier proyek adalah `qualification/evidence-gate.mjs`. Dua puluh gate berikut harus mempunyai material yang hash/ukurannya cocok dan attestation sah. Batas umur dihitung pada saat verifikasi; `expires_at` juga harus masih berlaku. Role registry penandatanganan berbeda dari role akun panel dan tidak otomatis diberikan oleh pembuatan akun staf.

| Gate | Role registry | Umur maksimum |
| --- | --- | --- |
| `backup_uno`, `backup_mahjong`, `backup_skygate` | `engineering_reviewer` | 25 jam |
| `ledger_reconciliation` | `engineering_reviewer` | 25 jam |
| `restore_drill`, `backup_retention_rotation`, `backup_alert_delivery`, `environment_isolation` | `engineering_reviewer` | 168 jam |
| `wallet_reference`, `load_500`, `load_1000`, `soak`, `network_restart`, `rollback_drill` | `engineering_reviewer` | 168 jam |
| `admin_mfa`, `api_security` | `security_reviewer`, manusia | 168 jam |
| `wallet_external_operator` | `operator_certifier`, manusia independen | 168 jam |
| `math_rng_review` | `math_reviewer`, manusia independen | 720 jam |
| `security_review` | `security_reviewer`, manusia independen | 720 jam |
| `legal_signoff` | `legal_approver`, manusia independen | 720 jam |

Reviewer independen tidak boleh sekaligus menjadi reviewer implementasi (`engineering_reviewer`) atau requester go-live pada paket yang sama. Seseorang boleh mempunyai beberapa kewenangan yang sah, tetapi aturan independensi dan perbedaan requester/approver tetap berlaku berdasarkan `person_id`, bukan jumlah key.

Materi `wallet_external_operator` harus berasal dari operator eksternal yang sebenarnya, memakai `classification:"external_operator_conformance"` dan `external_operator_id` nyata. Hasil reference wallet internal atau ID `op_qualification_...` tidak memenuhi gate. Sertifikasi tersebut memerlukan operator dan pihak penilai yang benar-benar berwenang.

Materi load/soak memakai `classification:"real_native_session_http_load"`, hasil sesi native yang nyata, source commit/identitas target yang sesuai, durasi dan ambang yang disepakati, serta metrik resource server yang sesuai waktunya. Hasil gagal dan pengujian fixture tetap dilabeli apa adanya. Materi retensi harus membedakan bukti canary conditional-delete, simulasi kebijakan, dan penghapusan archive yang memang terjadi; tidak ada klaim Object Lock/WORM tanpa kemampuan provider yang terbukti.

Materi matematika/RNG dan keamanan harus menyatakan ruang lingkup versi yang ditinjau, metode, temuan, resolusi dan keterbatasannya. Pihak legal memberi keputusan untuk yurisdiksi dan model operasi yang sebenarnya. Otomasi tidak mengisi keputusan atau identitas reviewer ini.

## 5. Penandatanganan dan pemeriksaan go-live

Penanggung jawab identitas memverifikasi setiap manusia, public key Ed25519, kewenangan, independensi dan masa berlaku sebelum memasukkannya ke registry terpisah yang dilindungi. `qualification/reviewer-registry.example.json` sengaja kosong dan harus gagal. Jangan menambahkan key fixture atau membuat key atas nama orang lain.

Siapkan `review/expected-production-target.json` dari identitas production yang benar-benar terpasang dan commit penuh Core, UNO, Mahjong, Skygate, serta wallet yang akan dirilis. Salin struktur dari `qualification/release-bundle.template.json`; placeholder tidak boleh dianggap target aktual. Setiap payload attestation berisi `schema_version:1`, gate, `status:"PASS"` hanya setelah review selesai, target yang sama, `verified_at`, `expires_at`, dan daftar material dengan path relatif, SHA256 serta ukuran byte.

Reviewer menjalankan sendiri perintah berikut dengan private key miliknya yang berizin `0600` dan key ID yang telah dipercaya registry:

```sh
node qualification/sign-attestation.mjs \
  --registry /private/trusted-reviewers.json \
  --key-id REAL_REVIEWER_KEY_ID \
  --private-key /private/reviewer-ed25519.pem \
  --payload review/completed-attestation.json \
  --output review/signed-attestation.json
```

Setelah kumpulan attestation final tersedia, requester dengan role registry `release_requester` dan approver yang berbeda dengan role `release_approver` menandatangani payload `go_live_request` dan `go_live_approve`. Keduanya harus manusia terverifikasi, paling lama 24 jam, memakai `release_id` sama dan `evidence_set_sha256` dari JSON canonical array attestation lengkap. Payload approver juga mengikat `requester_person_id`. Perubahan material, attestation atau target setelah itu memerlukan review/penandatanganan ulang.

Jalankan verifier:

```sh
node qualification/evidence-gate.mjs \
  --bundle review/release-bundle.json \
  --registry /private/trusted-reviewers.json \
  --target review/expected-production-target.json \
  --evidence-root review \
  --report evidence/go-live-verification.json
```

Simpan laporan lengkap, target, material yang diperiksa, key ID dan identitas penanggung jawab sesuai kebijakan akses. `ready:true` hanya menyatakan paket memenuhi pemeriksaan verifier. Verifier tidak mengubah deployment. Aktivasi production masih memerlukan langkah rilis yang secara eksplisit ditinjau setelah semua gate dan persetujuan tersebut lengkap; aplikasi yang ada sekarang tetap mengunci production.

## 6. Isian serah terima yang belum boleh direkayasa

- Pemilik nyata per lingkungan dan bukti enrollment MFA yang selesai.
- Requester dan approver nyata yang berbeda, dengan role panel dan pemetaan identitas registry yang telah diverifikasi.
- Operator eksternal, kontak penilai yang berwenang, ruang lingkup conformance dan keputusan sertifikasinya.
- Reviewer independen matematika/RNG, keamanan dan legal beserta keputusan yang ditandatangani.
- Target production final, semua commit lengkap, hasil teknis live yang sesuai target, dan tindakan korektif untuk hasil yang belum lulus.
- Permintaan/persetujuan go-live yang mengikat paket final, lalu keputusan cutover oleh penanggung jawab rilis.

Tidak ada nama, token, secret, persetujuan, atau status lulus aktual yang diisi oleh dokumen ini.
