# ♔ Xadrez Royale — Xadrez 3D Online

**Xadrez Royale** é um jogo de xadrez 3D para navegador (PC e celular) construído com **Three.js**, **Vite**, **`chess.js`** e **Firebase**, combinando visual editorial em alta definição, física tátil, regras oficiais FIDE, IA em Web Worker e Dica com **Stockfish 19 NNUE (WASM)**.

---

## ✨ Principais Recursos

### 🎨 Estúdio 3D & Temas PBR
- **Peças Staunton Esculpidas:** Todas as 6 peças (`Peão`, `Torre`, `Cavalo`, `Bispo`, `Dama`, `Rei`) com malhas 3D próprias e normalização de UV.
- **Texturas PBR Procedurais:** Mapas de cor (`map`), relevo (`bumpMap`) e rugosidade (`roughnessMap`), moldura chanfrada com filete metálico e bandeja lateral de peças capturadas.
- **Temas Disponíveis:**
  - *Tabuleiros:* **Nogueira Real**, **Mármore Carrara**, **Ardósia Clube**, **Alto Contraste** e **Vice Sunset (GTA VI)**.
  - *Peças:* **Buxo & Ébano**, **Marfim & Ônix**, **Latão & Aço**, **Daltônico (Ouro×Azul)** e **Vice Neon (GTA VI)**.
- **Desempenho Adaptativo (PC Fraco & Celular):** Detecção automática de hardware (`high` / `medium` / `low`) + monitoramento de FPS em tempo real, com ajuste manual em **⚙ Configurações**.

### 🧠 Inteligência Artificial & Dica Stockfish 19
- **Modos Offline (Web Worker):** Jogue contra a máquina em 3 níveis (**Casual**, **Clube**, **Mestre**) com busca Alpha-Beta + *Quiescence Search* rodando em thread separada sem travar a câmera 3D.
- **Dica 3D com Stockfish 19 NNUE (`💡 DICA` / tecla `H`):** Carregamento sob demanda de `stockfish-19-lite-single.wasm` (`1.8 MB`), exibindo seta 3D dourado-esmeralda animada, peça fantasma translúcida no destino e linha principal prevista (`PV`).
- **Análise Pós-Partida:** Revisão lance a lance com gráfico SVG de avaliação, precisão por cor (%) e classificação de jogadas (`!!`, `!`, `★`, `?!`, `?`, `??`).

### 🎯 Ferramentas Táticas estilo Chess.com
- **Setas & Marcação de Casas:**
  - **PC:** Arrastar com **botão direito** desenha setas (Verde padrão, `Shift` Vermelho, `Alt` Azul, `Ctrl` Amarelo); clicar com botão direito marca a casa; clique esquerdo limpa.
  - **Celular:** Botão **✎** no topo abre a barra flutuante de cores para traçar setas com o toque.
- **Histórico SAN Clicável & Navegação:** Botões `|<`, `<`, `>`, `>|` e clique direto em qualquer lance para inspecionar a posição.
- **Vista 2D Instantânea (`2D` / `V`) & Rotação (`⇅` / `F`).**

### 🌐 Modo Online (Firebase)
- **Matchmaking por Controle de Tempo:** `1+0`, `3+2`, `5+0`, `10+0` com cálculo de **Rating Elo** e **Ranking Top 10**.
- **Salas Privadas por Link:** Compartilhe `?room=CODIGO` para desafiar amigos.
- **Premove Online:** Arme seu próximo lance durante a vez do oponente (destacado em azul) para execução instantânea.
- **Login Google & Anônimo** via `linkWithPopup` + fallback para redirect.

### 🎵 Áudio & Música Ambiente
- Efeitos sonoros táteis sintetizados via **Web Audio API** (madeira, captura, roque, xeque, promoção, relógio) + **Música Ambiente Lo-Fi/Vice** procedural configurável em **⚙ Configurações**.

---

## ⌨️ Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| `H` | Pedir Dica (Stockfish 19) |
| `V` | Alternar vista 3D / 2D |
| `F` | Girar tabuleiro (180°) |
| `M` | Silenciar / Ativar áudio |
| `←` / `→` | Lance anterior / próximo no histórico |
| `Home` / `End` | Ir ao início / posição ao vivo |
| `Esc` | Fechar modais / cancelar premove ou modo setas |

---

## 🚀 Como Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. (Opcional) Configurar Firebase para modo online
cp .env.example .env
# Preencha as variáveis VITE_FIREBASE_* no arquivo .env

# 3. Iniciar servidor de desenvolvimento
npm run dev
```

### Testes & Build de Produção

```bash
# Testes unitários (engine, helpers, worker)
npm test

# Build de produção (gera dist/)
npm run build
```

---

## ☁️ Deploy (Vercel + Firebase)
1. Conecte o repositório no **Vercel** (o arquivo [`vercel.json`](vercel.json) já configura `npm run build` e saída `dist/`).
2. Adicione as variáveis `VITE_FIREBASE_*` nas **Environment Variables** do Vercel.
3. No **Firebase Console**, ative **Authentication** (Anônimo e Google), adicione o domínio do Vercel em **Authorized domains**, ative **Hosting** e publique [`firestore.rules`](firestore.rules).
