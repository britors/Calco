Name:           calco
Version:        1.0.0
Release:        1%{?dist}
Summary:        Editor de planilhas nativo em Rust e GTK4
License:        GPL-3.0-only
URL:            https://github.com/britors/Calco
Source0:        %{name}-%{version}.tar.gz
BuildRequires:  cargo
BuildRequires:  rust
BuildRequires:  pkgconfig(gtk4) >= 4.14

%description
Calco é um editor de planilhas desktop nativo escrito em Rust e GTK4.

%prep
%autosetup

%build
cargo build --release --offline

%install
install -Dm0755 target/release/calco %{buildroot}%{_bindir}/calco
install -Dm0644 data/br.com.w3ti.Calco.desktop %{buildroot}%{_datadir}/applications/br.com.w3ti.Calco.desktop
install -Dm0644 data/br.com.w3ti.Calco.metainfo.xml %{buildroot}%{_metainfodir}/br.com.w3ti.Calco.metainfo.xml
install -Dm0644 data/application-x-calco.xml %{buildroot}%{_datadir}/mime/packages/application-x-calco.xml
install -Dm0644 design/calco-icon-mark.svg %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/br.com.w3ti.Calco.svg

%files
%license LICENSE
%doc README.md
%{_bindir}/calco
%{_datadir}/applications/br.com.w3ti.Calco.desktop
%{_metainfodir}/br.com.w3ti.Calco.metainfo.xml
%{_datadir}/mime/packages/application-x-calco.xml
%{_datadir}/icons/hicolor/scalable/apps/br.com.w3ti.Calco.svg
