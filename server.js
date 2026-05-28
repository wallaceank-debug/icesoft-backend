require('dotenv').config();
// ==========================================
// PEÇAS DO MOTOR E CONFIGURAÇÕES
// ==========================================
const express = require('express');
const cors = require('cors');
const http = require('http'); // <-- NOVO
const { Server } = require('socket.io'); // <-- NOVO
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); 

const app = express();
// 1. Cria o servidor HTTP do Node encapsulando o Express
const server = http.createServer(app);

// 2. Acopla o Socket.IO ao servidor HTTP
const io = new Server(server, {
    cors: {
        origin: '*', // Permite que qualquer app (como nosso Electron) se conecte
        methods: ['GET', 'POST']
    }
});

// 3. Monitora quem se conecta no 'Rádio'
io.on('connection', (socket) => {
    console.log(`🔌 Novo dispositivo conectado no Kanban: ${socket.id}`);

    socket.on('disconnect', () => {
         console.log(`❌ Dispositivo desconectado: ${socket.id}`);
    });
});

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const pastaUploads = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(pastaUploads));

const storage = multer.memoryStorage(); 
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('imagem'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ sucesso: false, erro: "Nenhuma imagem foi enviada." });

        const nomeArquivo = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
        const caminhoFinal = path.join(pastaUploads, nomeArquivo);

        if (!fs.existsSync(pastaUploads)){ fs.mkdirSync(pastaUploads, { recursive: true }); }

        await sharp(req.file.buffer)
            .rotate() 
            .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }) 
            .webp({ quality: 80 }) 
            .toFile(caminhoFinal); 

        res.json({ sucesso: true, url: `/uploads/${nomeArquivo}` });
    } catch (erro) { 
        res.status(500).json({ sucesso: false, erro: "Erro ao comprimir e salvar a imagem." }); 
    }
});

// ==========================================
// CONEXÃO COM O BANCO DE DADOS NA NUVEM (NEON)
// ==========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

pool.connect()
    .then(() => {
        console.log('☁️ Banco de Dados PostgreSQL Conectado!');
        return pool.query(`
            CREATE TABLE IF NOT EXISTS vendas (
                id SERIAL PRIMARY KEY, produto_nome VARCHAR(255) DEFAULT 'Pedido Diversos',
                valor_total DECIMAL(10,2), forma_pagamento VARCHAR(50), itens JSONB DEFAULT '[]',
                data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status VARCHAR(50) DEFAULT 'Concluída',
                cliente_nome VARCHAR(100), cliente_telefone VARCHAR(20), cliente_endereco TEXT,
                origem VARCHAR(50) DEFAULT 'Balcão', observacoes TEXT, transacao_id VARCHAR(100),
                numero_diario INTEGER DEFAULT 0, data_diaria DATE DEFAULT CURRENT_DATE
            );
            CREATE TABLE IF NOT EXISTS configuracoes (chave VARCHAR(50) PRIMARY KEY, valor TEXT NOT NULL);
            INSERT INTO configuracoes (chave, valor) VALUES ('status_delivery', 'aberto') ON CONFLICT (chave) DO NOTHING;
            CREATE TABLE IF NOT EXISTS cidades (id SERIAL PRIMARY KEY, nome VARCHAR(100) UNIQUE NOT NULL);
            CREATE TABLE IF NOT EXISTS bairros (id SERIAL PRIMARY KEY, nome VARCHAR(100) NOT NULL, taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00, cidade VARCHAR(100) DEFAULT 'Quatis');
            CREATE TABLE IF NOT EXISTS mesas_ativas (id SERIAL PRIMARY KEY, numero VARCHAR(10) NOT NULL, itens JSONB DEFAULT '[]', status VARCHAR(20) DEFAULT 'Ocupada', data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS categorias (id SERIAL PRIMARY KEY, nome TEXT, ordem INTEGER, mostrar_cardapio BOOLEAN DEFAULT true);
            CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE, senha VARCHAR(100), cargo VARCHAR(50) DEFAULT 'admin', email VARCHAR(255));
            INSERT INTO usuarios (username, senha, email, cargo) VALUES ('admin', 'icesoft123', 'admin@icesoft.com', 'admin') ON CONFLICT (username) DO NOTHING;
            
            CREATE TABLE IF NOT EXISTS produtos (
                id SERIAL PRIMARY KEY, nome VARCHAR(255), descricao TEXT, preco DECIMAL(10,2), emoji VARCHAR(50),
                categoria VARCHAR(100), grupos_ids JSONB DEFAULT '[]', imagem_url TEXT, venda_por_peso BOOLEAN DEFAULT false,
                tag VARCHAR(50), tipo_promocao VARCHAR(50) DEFAULT 'nenhuma', valor_promocao DECIMAL(10,2) DEFAULT 0,
                promo_dias VARCHAR(50) DEFAULT '', promo_inicio VARCHAR(10) DEFAULT '', promo_fim VARCHAR(10) DEFAULT '',
                estoque INTEGER DEFAULT NULL, ordem INTEGER DEFAULT 0, promo_pdv BOOLEAN DEFAULT false, ativo BOOLEAN DEFAULT true
            );
            
            CREATE TABLE IF NOT EXISTS grupos_adicionais (id SERIAL PRIMARY KEY, nome VARCHAR(255), limite INTEGER, itens JSONB DEFAULT '[]', ativo BOOLEAN DEFAULT true, obrigatorio BOOLEAN DEFAULT false);
            CREATE TABLE IF NOT EXISTS funil_eventos (id SERIAL PRIMARY KEY, evento VARCHAR(50) NOT NULL, produto_nome VARCHAR(255), sessao_id VARCHAR(100), data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            
            CREATE TABLE IF NOT EXISTS controle_caixa (id SERIAL PRIMARY KEY, valor_inicial DECIMAL(10,2), valor_informado DECIMAL(10,2), valor_sistema DECIMAL(10,2), data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP, data_fechamento TIMESTAMP, status VARCHAR(20));
            CREATE TABLE IF NOT EXISTS movimentacoes_caixa (id SERIAL PRIMARY KEY, caixa_id INTEGER, tipo VARCHAR(50), valor DECIMAL(10,2), motivo TEXT, data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
            
            -- ==========================================
            -- NOVAS TABELAS DO MÓDULO FINANCEIRO
            -- ==========================================
            CREATE TABLE IF NOT EXISTS fin_contas_bancarias (
                id SERIAL PRIMARY KEY, nome VARCHAR(100) NOT NULL, saldo_inicial DECIMAL(10,2) DEFAULT 0.00
            );
            
            CREATE TABLE IF NOT EXISTS fin_categorias (
                id SERIAL PRIMARY KEY, nome VARCHAR(100) NOT NULL, tipo VARCHAR(20) NOT NULL, dre_ref VARCHAR(50)
            );
            
            CREATE TABLE IF NOT EXISTS fin_lancamentos (
                id SERIAL PRIMARY KEY, descricao TEXT, valor DECIMAL(10,2), data_vencimento DATE, 
                data_pagamento DATE, status VARCHAR(20) DEFAULT 'Pendente', tipo VARCHAR(20), 
                conta_id INTEGER, categoria_id INTEGER, recorrente BOOLEAN DEFAULT false
            );
        `);
    })
    .then(() => console.log("📦 Estrutura do Banco 100% Blindada e Pronta!"))
    .catch(err => console.error('❌ Erro no banco:', err));


app.get('/api/relatorios/funil', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let filtroSQL = ''; let params = [];
        if (inicio && fim) { filtroSQL = " AND data_hora::date BETWEEN $1 AND $2"; params = [inicio, fim]; }
        const visitantes = await pool.query(`SELECT COUNT(DISTINCT sessao_id) FROM funil_eventos WHERE evento = 'Visitou o Cardápio'${filtroSQL}`, params);
        const visualizacoes = await pool.query(`SELECT COUNT(*) FROM funil_eventos WHERE evento = 'Visualizou Produto'${filtroSQL}`, params);
        const carrinho = await pool.query(`SELECT COUNT(*) FROM funil_eventos WHERE evento = 'Adicionou ao Carrinho'${filtroSQL}`, params);
        const checkout = await pool.query(`SELECT COUNT(*) FROM funil_eventos WHERE evento = 'Iniciou Checkout'${filtroSQL}`, params);
       // 5. Vendas Reais (Apenas Online - Ignora PDV e Mesas)
        const vendas = await pool.query(`SELECT COUNT(*) FROM vendas WHERE status NOT ILIKE '%cancelad%' AND origem NOT ILIKE '%Balcão%' AND origem NOT ILIKE '%WhatsApp / Telefone%' AND origem NOT ILIKE '%Mesas%' ${filtroSQL}`, params);
        res.json({ visitantes: parseInt(visitantes.rows[0].count), visualizacoes: parseInt(visualizacoes.rows[0].count), carrinho: parseInt(carrinho.rows[0].count), checkout: parseInt(checkout.rows[0].count), vendas: parseInt(vendas.rows[0].count) });
    } catch (e) { res.status(500).json({ erro: "Erro ao calcular funil" }); }
});

// ==========================================
// 📊 NOVO ENDPOINT: RAIO-X DE PRODUTOS
// ==========================================
app.get('/api/relatorios/raiox-produtos', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let filtroSQL = ''; let params = [];
        if (inicio && fim) { 
            filtroSQL = " AND data_hora::date BETWEEN $1 AND $2"; 
            params = [inicio, fim]; 
        }

        // Puxa quantas vezes cada produto foi visualizado na tela do cliente
        const visitas = await pool.query(`
            SELECT produto_nome, COUNT(*) as visitas 
            FROM funil_eventos 
            WHERE evento = 'Visualizou Produto' AND produto_nome IS NOT NULL ${filtroSQL} 
            GROUP BY produto_nome
        `, params);

        res.json({ visitas: visitas.rows });
    } catch (e) { 
        console.error("Erro no Raio-X:", e);
        res.status(500).json({ erro: "Erro ao calcular visitas por produto" }); 
    }
});

app.get('/api/vendas', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let querySql = 'SELECT * FROM vendas'; let params = [];
        if (inicio && fim) { querySql += ' WHERE data_hora::date BETWEEN $1 AND $2'; params = [inicio, fim]; }
        querySql += ' ORDER BY data_hora DESC';
        res.json((await pool.query(querySql, params)).rows);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar vendas" }); }
});

app.post('/api/vendas', async (req, res) => { 
    try { 
        const { produto_nome, valor_total, total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id } = req.body;
        const valorFinal = valor_total || total || 0;
        const origemFinal = origem || 'Balcão';
        
        const queryDiario = await pool.query("SELECT COALESCE(MAX(numero_diario), 0) + 1 AS proximo FROM vendas WHERE data_diaria = CURRENT_DATE");
        const numeroDiario = queryDiario.rows[0].proximo;

        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id, numero_diario, data_diaria) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE)`, 
            [produto_nome, valorFinal, forma_pagamento, JSON.stringify(itens || []), status || 'Concluída', cliente_nome, cliente_telefone, cliente_endereco, origemFinal, observacoes || '', transacao_id || null, numeroDiario]
        ); 

        // Avisa todos os dispositivos conectados que tem pedido novo!
        io.emit('novo_pedido_kanban', { 
            id: numeroDiario, 
            cliente: cliente_nome, 
            status: status || 'Concluída' 
        });

        try {
          let itensComprados = typeof itens === 'string' ? JSON.parse(itens) : (itens || []);
          const queryEstoque = await pool.query("SELECT id, nome, estoque, ativo FROM produtos");
          let produtosNoBanco = queryEstoque.rows.sort((a, b) => b.nome.length - a.nome.length);

          for (let item of itensComprados) {
            let qtd = item.quantidade ? Number(item.quantidade) : 1;
            let nomeRaw = item.nome || item.produto_nome || item.nomeBase || "";
            if (typeof nomeRaw === 'string' && nomeRaw.trim() !== "") {
              let nomeBusca = nomeRaw.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
              let p = produtosNoBanco.find(prod => {
                  let nomeBD = prod.nome.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                  return nomeBusca.includes(nomeBD);
              });
              if (p && p.estoque !== null && p.estoque > 0) {
                  let novoEstoque = Number(p.estoque) - qtd;
                  let continuaAtivo = p.ativo;
                  if (novoEstoque <= 0) { novoEstoque = 0; continuaAtivo = false; }
                  await pool.query("UPDATE produtos SET estoque = $1, ativo = $2 WHERE id = $3", [novoEstoque, continuaAtivo, p.id]);
              }
            }
          }
        } catch (erroEstoque) { console.error("❌ Erro ao baixar estoque:", erroEstoque); }

        if (cliente_telefone && cliente_telefone.trim() !== '') {
            try {
                const configQuery = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
                const config = configQuery.rows[0];

                if (config && config.msg_recebido && config.msg_recebido.trim() !== '' && config.zap_url && config.zap_key && config.zap_instancia) {
                    const primeiroNome = cliente_nome ? cliente_nome.split(' ')[0] : 'Cliente';
                    const textoPronto = config.msg_recebido.replace(/{nome}/g, primeiroNome).replace(/{pedido}/g, numeroDiario || 'Novo');
                    const telefoneLimpo = "55" + cliente_telefone.replace(/\D/g, '');
                    const urlZap = config.zap_url.trim().replace(/\/$/, "");
                    const instanciaURL = encodeURIComponent(config.zap_instancia.trim());

                    fetch(`${urlZap}/message/sendText/${instanciaURL}`, {
                        method: 'POST', headers: { 'apikey': config.zap_key.trim(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ number: telefoneLimpo, text: textoPronto })
                    }).catch(err => console.log("⚠️ Erro msg recebido (Silenciado):", err.message));
                }
            } catch (errZap) {}
        }
        res.status(201).json({ sucesso: true });
    } catch (erroGeral) { res.status(500).json({ erro: "Erro interno" }); }
});
        
app.put('/api/vendas/:id/status', async (req, res) => { 
    try { 
        const novoStatus = req.body.status;
        const idVenda = req.params.id;

        await pool.query("UPDATE vendas SET status = $1 WHERE id = $2", [novoStatus, idVenda]); 
        res.json({ sucesso: true }); 

        const vendaQuery = await pool.query("SELECT * FROM vendas WHERE id = $1", [idVenda]);
        const venda = vendaQuery.rows[0];

        if (venda && venda.cliente_telefone && venda.cliente_telefone.trim() !== '') {
            const configQuery = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
            const config = configQuery.rows[0];

            if (config && config.zap_url && config.zap_key && config.zap_instancia) {
                let textoMensagem = null;
                if (novoStatus === 'A Preparar' && config.msg_aceito) textoMensagem = config.msg_aceito;
                else if (novoStatus === 'Saiu p/ Entrega' && config.msg_entrega) textoMensagem = config.msg_entrega;
                else if (novoStatus === 'Entregue' && config.msg_concluido) textoMensagem = config.msg_concluido;

                if (textoMensagem) {
                    const primeiroNome = venda.cliente_nome ? venda.cliente_nome.split(' ')[0] : 'Cliente';
                    let textoPronto = textoMensagem.replace(/{nome}/g, primeiroNome).replace(/{pedido}/g, venda.numero_diario || venda.id);

                    if (novoStatus === 'A Preparar') {
                        let resumo = `\n\n*🛒 Resumo do seu pedido:*\n`;
                        try {
                            const itens = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens;
                            itens.forEach(item => { resumo += `▪️ 1x ${item.nome.replace('Delivery: ', '')} - R$ ${Number(item.preco).toFixed(2).replace('.', ',')}\n`; });
                        } catch(e) {}
                        resumo += `\n*💰 Total:* R$ ${Number(venda.valor_total).toFixed(2).replace('.', ',')}`;
                        resumo += `\n*💳 Pagamento:* ${venda.forma_pagamento}`;
                        if (venda.cliente_endereco && !venda.cliente_endereco.includes('Retirada')) resumo += `\n*📍 Entrega:* ${venda.cliente_endereco}`;
                        else resumo += `\n*🏬 Retirada na Loja*`;
                        if (venda.observacoes && venda.observacoes.trim() !== '') resumo += `\n*📝 Obs:* ${venda.observacoes}`;

                        // ==========================================
                        // 🟢 INÍCIO DA MÁGICA DA FIDELIDADE
                        // ==========================================
                        try {
                            // Conta quantos pedidos válidos esse número já fez na loja
                            const countQuery = await pool.query("SELECT COUNT(*) FROM vendas WHERE cliente_telefone = $1 AND status NOT ILIKE '%cancelad%'", [venda.cliente_telefone]);
                            let pontosTotais = parseInt(countQuery.rows[0].count) || 1;
                            let metaFidelidade = 10; // 🎯 Defina a meta aqui (10 pedidos)
                            
                            // Matemática inteligente: se ele tem 13 pontos, ele está no pedido 3 da cartela nova.
                            let pontosAtuais = pontosTotais % metaFidelidade; 
                            // Se bater exatos 10, 20, 30... a conta acima dá zero, então forçamos a mostrar a barra cheia (10)
                            if (pontosAtuais === 0 && pontosTotais > 0) pontosAtuais = metaFidelidade;

                            // Desenha as bolinhas automaticamente
                            let bolinhasVerdes = '🟢'.repeat(pontosAtuais);
                            let bolinhasVermelhas = '🔴'.repeat(metaFidelidade - pontosAtuais);

                            resumo += `\n\n🎁 *Seu Progresso de Fidelidade:*\n${bolinhasVerdes}${bolinhasVermelhas}\n`;
                            
                            if (pontosAtuais === metaFidelidade) {
                                resumo += `🎉 *Parabéns!* Você completou sua cartela! O seu próximo pedido tem prêmio!`;
                            } else {
                                resumo += `Faltam apenas ${metaFidelidade - pontosAtuais} pedidos para o seu prêmio!`;
                            }
                        } catch(erroFid) {
                            console.error("Erro ao calcular fidelidade:", erroFid);
                        }
                        // ==========================================
                        // 🔴 FIM DA MÁGICA DA FIDELIDADE
                        // ==========================================

                        textoPronto += resumo;
                    }

                    const telefoneLimpo = "55" + venda.cliente_telefone.replace(/\D/g, '');
                    const url = config.zap_url.trim().replace(/\/$/, "");
                    const instanciaURL = encodeURIComponent(config.zap_instancia.trim());

                    fetch(`${url}/message/sendText/${instanciaURL}`, {
                        method: 'POST', headers: { 'apikey': config.zap_key.trim(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ number: telefoneLimpo, text: textoPronto })
                    }).catch(err => console.error("⚠️ Robô falhou:", err));
                }
            }
        }
    } catch (e) { console.error("Erro status:", e); }
});

// ==========================================
// 💳 NOVA ROTA: ATUALIZAR FORMA DE PAGAMENTO
// ==========================================
app.put('/api/vendas/:id/pagamento', async (req, res) => {
    try {
        const { forma_pagamento } = req.body;
        await pool.query("UPDATE vendas SET forma_pagamento = $1 WHERE id = $2", [forma_pagamento, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao atualizar pagamento:", e);
        res.status(500).json({ erro: "Erro ao atualizar pagamento" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM usuarios WHERE (username = $1 OR email = $1) AND senha = $2', [req.body.username, req.body.senha]);
        if (resultado.rows.length > 0) res.json({ sucesso: true, token: "token-" + Date.now(), cargo: resultado.rows[0].cargo, usuario_id: resultado.rows[0].id });
        else res.status(401).json({ sucesso: false, erro: "Incorreto" });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const { novo_username, novo_email, nova_senha } = req.body;
        const user = (await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.params.id])).rows[0];
        if (!user) return res.status(404).json({ erro: "Não encontrado" });
        await pool.query('UPDATE usuarios SET username = $1, email = $2, senha = $3 WHERE id = $4', [novo_username || user.username, novo_email || user.email, nova_senha || user.senha, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.get('/api/ranking', async (req, res) => {
    try { res.json((await pool.query(`SELECT item->>'nome' as nome, COUNT(*) as quantidade FROM vendas, jsonb_array_elements(itens) AS item GROUP BY nome ORDER BY quantidade DESC LIMIT 5`)).rows); } 
    catch (e) { res.status(500).send("Erro"); }
});

app.get('/api/caixa/status', async (req, res) => { try { res.json((await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1')).rows[0] || { status: 'Fechado' }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/caixa/abrir', async (req, res) => { try { res.json({ sucesso: true, caixa: (await pool.query("INSERT INTO controle_caixa (valor_inicial, status) VALUES ($1, 'Aberto') RETURNING *", [req.body.valor_inicial || 0])).rows[0] }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

// ==========================================
// 🔒 FECHAMENTO DE CAIXA COM INJEÇÃO FINANCEIRA (CONTA DE TRANSIÇÃO)
// ==========================================
app.put('/api/caixa/fechar/:id', async (req, res) => {
    try {
        // 1. Fecha o caixa e captura a data exata
        const resultCaixa = await pool.query(
            "UPDATE controle_caixa SET status = 'Fechado', data_fechamento = CURRENT_TIMESTAMP, valor_informado = $1, valor_sistema = $2 WHERE id = $3 RETURNING *",
            [req.body.valor_informado || 0, req.body.valor_sistema || 0, req.params.id]
        );
        const caixa = resultCaixa.rows[0];

        // 2. Busca todas as vendas finalizadas durante o turno deste caixa
        const vendasQuery = await pool.query(`
            SELECT forma_pagamento, SUM(valor_total) as total
            FROM vendas
            WHERE data_hora >= $1 AND data_hora <= $2 AND status NOT ILIKE '%cancelad%'
            GROUP BY forma_pagamento
        `, [caixa.data_abertura, caixa.data_fechamento]);

        let totalDinheiro = 0;
        let totalDigital = 0;

        vendasQuery.rows.forEach(v => {
            const valor = parseFloat(v.total);
            if (v.forma_pagamento.toLowerCase().includes('dinheiro')) {
                totalDinheiro += valor;
            } else {
                totalDigital += valor;
            }
        });

        // 3. Garante que a Categoria "Invisível" (Conta Transitória) exista para não duplicar no DRE
        let catResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'movimentacao_interna' LIMIT 1");
        if (catResult.rows.length === 0) {
            catResult = await pool.query("INSERT INTO fin_categorias (nome, tipo, dre_ref) VALUES ('Transferência / Fechamento', 'Receita', 'movimentacao_interna') RETURNING id");
        }
        const categoriaId = catResult.rows[0].id;

        // 4. Garante que as contas de Banco existem
        let contaFisicoResult = await pool.query("SELECT id FROM fin_contas_bancarias WHERE nome ILIKE '%Caixa Físico%' LIMIT 1");
        if (contaFisicoResult.rows.length === 0) {
            contaFisicoResult = await pool.query("INSERT INTO fin_contas_bancarias (nome, saldo_inicial) VALUES ('Caixa Físico (Gaveta)', 0) RETURNING id");
        }
        const contaFisicoId = contaFisicoResult.rows[0].id;

        let contaTransicaoResult = await pool.query("SELECT id FROM fin_contas_bancarias WHERE nome ILIKE '%Transição%' LIMIT 1");
        if (contaTransicaoResult.rows.length === 0) {
            contaTransicaoResult = await pool.query("INSERT INTO fin_contas_bancarias (nome, saldo_inicial) VALUES ('Conta de Transição (A Receber)', 0) RETURNING id");
        }
        const contaTransicaoId = contaTransicaoResult.rows[0].id;

        // 5. Injeta no Financeiro silenciosamente
        const promessasLancamentos = [];
        const dataFormatada = new Date().toISOString().split('T')[0]; // Hoje

        if (totalDinheiro > 0) {
            promessasLancamentos.push(pool.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)
            `, [`Fechamento de Caixa #${caixa.id} (Dinheiro)`, totalDinheiro, dataFormatada, categoriaId, contaFisicoId]));
        }

        if (totalDigital > 0) {
            promessasLancamentos.push(pool.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)
            `, [`Fechamento de Caixa #${caixa.id} (Cartões/Pix/Ifood)`, totalDigital, dataFormatada, categoriaId, contaTransicaoId]));
        }

        await Promise.all(promessasLancamentos);

        res.json({ sucesso: true, caixa });
    } catch (e) {
        console.error("Erro no fechamento com financeiro:", e);
        res.status(500).json({ erro: "Erro interno no fechamento" });
    }
});

app.post('/api/caixa/movimentacao', async (req, res) => { try { res.json({ sucesso: true, movimentacao: (await pool.query("INSERT INTO movimentacoes_caixa (caixa_id, tipo, valor, motivo) VALUES ($1, $2, $3, $4) RETURNING *", [req.body.caixa_id, req.body.tipo, req.body.valor, req.body.motivo])).rows[0] }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.get('/api/caixa/resumo/:id', async (req, res) => {
    try {
        const caixa = (await pool.query('SELECT * FROM controle_caixa WHERE id = $1', [req.params.id])).rows[0];
        if (!caixa) return res.status(404).json({ erro: "Não encontrado" });
        const vendasDinheiro = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total_vendas FROM vendas WHERE forma_pagamento ILIKE '%dinheiro%' AND status NOT ILIKE '%cancelad%' AND data_hora >= $1`, [caixa.data_abertura])).rows[0].total_vendas) || 0;
        const movs = (await pool.query(`SELECT tipo, COALESCE(SUM(valor), 0) as total FROM movimentacoes_caixa WHERE caixa_id = $1 GROUP BY tipo`, [req.params.id])).rows;
        let suprimentos = 0, sangrias = 0;
        movs.forEach(r => { if (r.tipo === 'Suprimento') suprimentos = parseFloat(r.total); if (r.tipo === 'Sangria') sangrias = parseFloat(r.total); });
        res.json({ fundo: parseFloat(caixa.valor_inicial) || 0, vendas_dinheiro: vendasDinheiro, suprimentos, sangrias, esperado: (parseFloat(caixa.valor_inicial) || 0) + vendasDinheiro + suprimentos - sangrias });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.get('/api/caixa/historico', async (req, res) => {
  try {
    const caixas = (await pool.query(`SELECT * FROM controle_caixa WHERE status = 'Fechado' AND TO_CHAR(data_fechamento, 'YYYY-MM') = $1 ORDER BY data_fechamento DESC`, [req.query.mes])).rows;
    let historico = [];
    for (let c of caixas) {
        const vendasDinheiro = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE forma_pagamento ILIKE '%dinheiro%' AND data_hora >= $1 AND data_hora <= $2`, [c.data_abertura, c.data_fechamento])).rows[0].total) || 0;
        const vendasCartao = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE (forma_pagamento ILIKE '%cartão%' OR forma_pagamento ILIKE '%cartao%') AND data_hora >= $1 AND data_hora <= $2`, [c.data_abertura, c.data_fechamento])).rows[0].total) || 0;
        const vendasPix = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE forma_pagamento ILIKE '%pix%' AND data_hora >= $1 AND data_hora <= $2`, [c.data_abertura, c.data_fechamento])).rows[0].total) || 0;
        const despesas = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor), 0) as total FROM movimentacoes_caixa WHERE caixa_id = $1 AND LOWER(TRIM(tipo)) = 'sangria'`, [c.id])).rows[0].total) || 0;
        historico.push({ id: c.id, dataAbertura: c.data_abertura ? new Date(c.data_abertura).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro', dataFechamento: c.data_fechamento ? new Date(c.data_fechamento).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro', totalCartao: vendasCartao, totalDinheiro: vendasDinheiro, totalPix: vendasPix, totalDespesas: despesas });
    }
    res.json(historico);
  } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.get('/api/caixa/:id/detalhes', async (req, res) => {
  try {
    const caixa = (await pool.query('SELECT * FROM controle_caixa WHERE id = $1', [req.params.id])).rows[0];
    if (!caixa) return res.status(404).json({ erro: "Não encontrado" });
    const movimentacoes = (await pool.query('SELECT * FROM movimentacoes_caixa WHERE caixa_id = $1 ORDER BY id DESC', [req.params.id])).rows;
    let vendas = caixa.data_abertura && caixa.data_fechamento ? (await pool.query('SELECT * FROM vendas WHERE data_hora >= $1 AND data_hora <= $2 ORDER BY data_hora DESC', [caixa.data_abertura, caixa.data_fechamento])).rows : [];
    res.json({ caixa, movimentacoes, vendas });
  } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.get('/api/mesas', async (req, res) => { try { res.json((await pool.query('SELECT * FROM mesas_ativas ORDER BY numero ASC')).rows); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/mesas', async (req, res) => { try { res.status(201).json((await pool.query("INSERT INTO mesas_ativas (numero, itens) VALUES ($1, $2) RETURNING *", [req.body.numero, JSON.stringify(req.body.itens || [])])).rows[0]); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.put('/api/mesas/:id', async (req, res) => { try { res.json((await pool.query("UPDATE mesas_ativas SET itens = $1 WHERE id = $2 RETURNING *", [JSON.stringify(req.body.itens), req.params.id])).rows[0]); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.delete('/api/mesas/:id', async (req, res) => { try { await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

app.put('/api/produtos/:id/estoque', async (req, res) => { try { await pool.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [req.body.estoque, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro: "Erro"}); } });
app.get('/api/status', (req, res) => res.json({ mensagem: "✅ Motor v5.0 pronto!" }));
app.get('/api/produtos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM produtos ORDER BY ordem ASC, id ASC')).rows.map(p => ({...p, preco: parseFloat(p.preco)}))); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/produtos/ordem', async (req, res) => { try { for (let p of req.body) { await pool.query('UPDATE produtos SET ordem = $1 WHERE id = $2', [p.ordem, p.id]); } res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro: "Erro"}); } });
app.post('/api/produtos', async (req, res) => { try { res.json({ sucesso: true, produto: (await pool.query('INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url, venda_por_peso, tag, tipo_promocao, valor_promocao, promo_dias, promo_inicio, promo_fim, promo_pdv) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *', [req.body.nome, req.body.descricao, req.body.preco, req.body.emoji, req.body.categoria || 'Outros', req.body.grupos_ids || [], req.body.imagem_url, req.body.venda_por_peso || false, req.body.tag || '', req.body.tipo_promocao || 'nenhuma', req.body.valor_promocao || 0, req.body.promo_dias || '', req.body.promo_inicio || '', req.body.promo_fim || '', req.body.promo_pdv || false])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.put('/api/produtos/:id', async (req, res) => { try { res.json({ sucesso: true, produto: (await pool.query('UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6, imagem_url = $7, venda_por_peso = $8, tag = $9, tipo_promocao = $10, valor_promocao = $11, promo_dias = $12, promo_inicio = $13, promo_fim = $14, promo_pdv = $15 WHERE id = $16 RETURNING *', [req.body.nome, req.body.descricao, req.body.preco, req.body.emoji, req.body.categoria || 'Outros', req.body.grupos_ids || [], req.body.imagem_url, req.body.venda_por_peso || false, req.body.tag || '', req.body.tipo_promocao || 'nenhuma', req.body.valor_promocao || 0, req.body.promo_dias || '', req.body.promo_inicio || '', req.body.promo_fim || '', req.body.promo_pdv || false, req.params.id])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.delete('/api/produtos/:id', async (req, res) => { try { await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/produtos/:id/status', async (req, res) => { try { await pool.query('UPDATE produtos SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/grupos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/grupos', async (req, res) => { try { res.json({ sucesso: true, grupo: (await pool.query('INSERT INTO grupos_adicionais (nome, limite, itens, obrigatorio) VALUES ($1, $2, $3, $4) RETURNING *', [req.body.nome, req.body.limite, req.body.itens ? JSON.stringify(req.body.itens) : '[]', req.body.obrigatorio || false])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/grupos/:id', async (req, res) => { try { res.json({ sucesso: true, grupo: (await pool.query('UPDATE grupos_adicionais SET nome = $1, limite = $2, itens = $3, obrigatorio = $4 WHERE id = $5 RETURNING *', [req.body.nome, req.body.limite, req.body.itens ? JSON.stringify(req.body.itens) : '[]', req.body.obrigatorio || false, req.params.id])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/grupos/:id', async (req, res) => { try { await pool.query('DELETE FROM grupos_adicionais WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/grupos/:id/status', async (req, res) => { try { await pool.query('UPDATE grupos_adicionais SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/categorias', async (req, res) => { try { res.json((await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/categorias', async (req, res) => { try { res.json({ sucesso: true, categoria: (await pool.query('INSERT INTO categorias (nome, ordem, mostrar_cardapio) VALUES ($1, $2, $3) RETURNING *', [req.body.nome, req.body.ordem || 0, req.body.mostrar_cardapio !== false])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.delete('/api/categorias/:id', async (req, res) => { try { await pool.query('DELETE FROM categorias WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/categorias/ordem', async (req, res) => { try { for (let cat of req.body) { await pool.query('UPDATE categorias SET ordem = $1 WHERE id = $2', [cat.ordem, cat.id]); } res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro: "Erro"}); } });
app.put('/api/categorias/:id', async (req, res) => { try { await pool.query('UPDATE categorias SET mostrar_cardapio = $1 WHERE id = $2', [req.body.mostrar_cardapio !== false, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.get('/api/cidades', async (req, res) => { try { res.json((await pool.query('SELECT * FROM cidades ORDER BY nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/cidades', async (req, res) => { try { res.json((await pool.query('INSERT INTO cidades (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING RETURNING *', [req.body.nome])).rows[0]); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/cidades/:id', async (req, res) => { try { await pool.query('DELETE FROM cidades WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/bairros', async (req, res) => { try { res.json((await pool.query('SELECT * FROM bairros ORDER BY cidade ASC, nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/bairros', async (req, res) => { try { res.json((await pool.query('INSERT INTO bairros (nome, taxa, cidade) VALUES ($1, $2, $3) RETURNING *', [req.body.nome, req.body.taxa, req.body.cidade || 'Quatis'])).rows[0]); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.delete('/api/bairros/:id', async (req, res) => { try { await pool.query('DELETE FROM bairros WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/loja/status', async (req, res) => { try { res.json({ status: (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'status_delivery'")).rows[0]?.valor || 'aberto' }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/loja/status', async (req, res) => { try { await pool.query("UPDATE configuracoes SET valor = $1 WHERE chave = 'status_delivery'", [req.body.status]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/configuracoes', async (req, res) => { try { const configs = {}; (await pool.query("SELECT * FROM configuracoes")).rows.forEach(r => configs[r.chave] = r.valor); res.json(configs); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/configuracoes', async (req, res) => { try { for (let chave of Object.keys(req.body)) { await pool.query(`INSERT INTO configuracoes (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [chave, String(req.body[chave])]); } res.json({ sucesso: true }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

app.get('/api/crm/clientes', async (req, res) => {
    try {
        const queryInteligente = `
            WITH cliente_base AS (
                SELECT 
                    cliente_telefone AS telefone, 
                    MAX(cliente_nome) AS nome, 
                    COUNT(*) AS total_pedidos, 
                    SUM(valor_total) AS total_gasto, 
                    MAX(data_hora) AS ultima_compra
                FROM vendas 
                WHERE cliente_telefone IS NOT NULL AND TRIM(cliente_telefone) != '' AND status != 'Cancelada' AND status != 'Cancelado'
                GROUP BY cliente_telefone
            ),
            contagem_produtos AS (
                SELECT 
                    v.cliente_telefone AS telefone,
                    TRIM(SPLIT_PART(REPLACE(COALESCE(item->>'nome', item->>'produto_nome', item->>'nomeBase', 'Diversos'), 'Delivery: ', ''), '(', 1)) AS nome_produto,
                    COUNT(*) AS total_vezes,
                    ROW_NUMBER() OVER (
                        PARTITION BY v.cliente_telefone 
                        ORDER BY COUNT(*) DESC, TRIM(SPLIT_PART(REPLACE(COALESCE(item->>'nome', item->>'produto_nome', item->>'nomeBase', 'Diversos'), 'Delivery: ', ''), '(', 1)) ASC
                    ) as rank_favorito
                FROM vendas v
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE 
                        WHEN jsonb_typeof(v.itens) = 'string' AND (v.itens#>>'{}') LIKE '[%' THEN (v.itens#>>'{}')::jsonb
                        WHEN jsonb_typeof(v.itens) = 'array' THEN v.itens 
                        ELSE '[]'::jsonb 
                    END
                ) AS item
                WHERE v.cliente_telefone IS NOT NULL AND TRIM(v.cliente_telefone) != '' AND v.status != 'Cancelada' AND v.status != 'Cancelado'
                GROUP BY v.cliente_telefone, TRIM(SPLIT_PART(REPLACE(COALESCE(item->>'nome', item->>'produto_nome', item->>'nomeBase', 'Diversos'), 'Delivery: ', ''), '(', 1))
            )
            SELECT 
                cb.telefone, 
                cb.nome, 
                cb.total_pedidos, 
                cb.total_gasto, 
                cb.ultima_compra,
                COALESCE(cp.nome_produto, 'Diversos') AS produto_favorito
            FROM cliente_base cb
            LEFT JOIN contagem_produtos cp ON cb.telefone = cp.telefone AND cp.rank_favorito = 1
            ORDER BY cb.ultima_compra DESC
        `;
        
        const resultado = await pool.query(queryInteligente);
        res.json(resultado.rows);
    } catch (erro) { 
        console.error("❌ Erro ao processar produtos favoritos no CRM:", erro);
        res.status(500).json({ erro: "Erro ao carregar inteligência de clientes." }); 
    }
});

pool.query(`
    CREATE TABLE IF NOT EXISTS integracoes_config (
        id SERIAL PRIMARY KEY, zap_url TEXT, zap_key TEXT, zap_instancia TEXT,
        msg_boas_vindas TEXT, msg_recebido TEXT, msg_aceito TEXT, msg_entrega TEXT, msg_concluido TEXT
    );
`).then(async () => {
    await pool.query('ALTER TABLE integracoes_config ADD COLUMN IF NOT EXISTS msg_recebido TEXT');
    if ((await pool.query('SELECT * FROM integracoes_config')).rowCount === 0) await pool.query('INSERT INTO integracoes_config (zap_instancia) VALUES ($1)', ['IcesoftBot']);
}).catch(console.error);

app.get('/api/integracoes', async (req, res) => { try { res.json((await pool.query('SELECT * FROM integracoes_config LIMIT 1')).rows[0] || {}); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.put('/api/integracoes', async (req, res) => {
    try {
        const dados = req.body;
        if (!dados || Object.keys(dados).length === 0) return res.json({ sucesso: true }); 
        if ((await pool.query('SELECT * FROM integracoes_config')).rowCount === 0) await pool.query('INSERT INTO integracoes_config (zap_instancia) VALUES ($1)', ['IcesoftBot']);
        const chaves = Object.keys(dados);
        let querySet = chaves.map((chave, index) => `${chave} = $${index + 1}`).join(', ');
        await pool.query(`UPDATE integracoes_config SET ${querySet}`, Object.values(dados));
        res.json({ sucesso: true });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

// ==========================================
// 🤖 ROTAS DE INTEGRAÇÃO DO WHATSAPP (CORRIGIDAS)
// ==========================================
app.get('/api/whatsapp/qrcode', async (req, res) => {
    try {
        const config = (await pool.query('SELECT * FROM integracoes_config LIMIT 1')).rows[0];
        if (!config || !config.zap_url || !config.zap_key || !config.zap_instancia) return res.status(400).json({ erro: "Configuração ausente" });

        const url = config.zap_url.trim().replace(/\/$/, ""); 
        const key = config.zap_key.trim();
        const instanciaURL = encodeURIComponent(config.zap_instancia.trim());
        const headers = { 'apikey': key, 'Content-Type': 'application/json' };

        const resStatus = await fetch(`${url}/instance/connectionState/${instanciaURL}`, { headers });
        
        let isConnected = false;
        let qrCodeBase64 = null;
        let msgRetorno = null;

        if (resStatus.status === 404) {
            const resCreate = await fetch(`${url}/instance/create`, {
                method: 'POST', headers: headers,
                body: JSON.stringify({
                    instanceName: config.zap_instancia.trim(),
                    qrcode: true, integration: "WHATSAPP-BAILEYS",
                    reject_call: true, groupsIgnore: true, readMessages: false, readStatus: false, syncFullHistory: false   
                })
            });
            const dataCreate = await resCreate.json();
            qrCodeBase64 = dataCreate.qrcode?.base64 || dataCreate.base64;
        } else if (!resStatus.ok) {
            return res.status(400).json({ erro: "A Evolution API recusou a conexão." });
        } else {
            const dataStatus = await resStatus.json();
            const estado = dataStatus.instance?.state || dataStatus.state;
            if (estado === 'open') {
                isConnected = true;
                msgRetorno = 'O WhatsApp já está conectado!';
            }
        }
        
        // 👇 NOVO: FORÇANDO A EVOLUTION API A IGNORAR GRUPOS NO NÍVEL DO SISTEMA
        try {
            await fetch(`${url}/settings/set/${instanciaURL}`, {
                method: 'POST', headers: headers,
                body: JSON.stringify({ reject_call: true, groups_ignore: true, read_messages: false, read_status: false })
            });
            console.log("🤫 Evolution API configurada para silenciar Grupos no motor!");
        } catch(es) { console.error("Erro config grupos", es); }

        // 👇 CONFIGURANDO O WEBHOOK (RODA MESMO SE JÁ CONECTADO)
        try {
            const webhookUrl = "https://icesoft-sistema-icesoft-api-v2.tm3i9u.easypanel.host/api/whatsapp/webhook";
            await fetch(`${url}/webhook/set/${instanciaURL}`, {
                method: 'POST', headers: headers,
                body: JSON.stringify({ url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: ["MESSAGES_UPSERT"] })
            });
            console.log("🔗 Webhook do WhatsApp configurado com sucesso!");
        } catch(ew) { console.error("Erro webhook", ew); }
        
        if (isConnected) return res.json({ status: 'CONECTADO', mensagem: msgRetorno });
        if (qrCodeBase64) return res.json({ status: 'QRCODE', qrcode: qrCodeBase64 });

        const resQr = await fetch(`${url}/instance/connect/${instanciaURL}`, { headers });
        const dataQr = await resQr.json();
        const qrFinal = dataQr.base64 || dataQr.qrcode?.base64;

        if (qrFinal) return res.json({ status: 'QRCODE', qrcode: qrFinal });
        return res.json({ status: 'AGUARDANDO', mensagem: 'Aguarde 5 segundos...' });

    } catch (e) {
        console.error("❌ Erro fatal na API do Zap:", e);
        res.status(500).json({ erro: "Falha de rede." });
    }
});

app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const mpToken = (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'")).rows[0]?.valor;
        if (!mpToken) return res.status(400).json({ erro: "Mercado Pago não configurado." });

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${mpToken}`, 'X-Idempotency-Key': "ICE-" + Date.now(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction_amount: Number(req.body.valor), description: "Pedido Icesoft Delivery", payment_method_id: "pix", payer: { email: "delivery@icesoft.com.br", first_name: req.body.cliente_nome || "Cliente" } })
        });
        const data = await mpResponse.json();
        if (data.error || !data.point_of_interaction) return res.status(500).json({ erro: "Falha ao gerar o Pix." });
        res.json({ sucesso: true, transacao_id: data.id, qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64, qr_code_copia_cola: data.point_of_interaction.transaction_data.qr_code });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.post('/api/pagamento/webhook', async (req, res) => {
    res.status(200).send("OK");
    try {
        if (req.body.type === 'payment') {
            const pagamentoId = req.body.data.id;
            const mpToken = (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'")).rows[0]?.valor;
            const pgtoInfo = await (await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })).json();
            if (pgtoInfo.status === 'approved') {
                const resultado = await pool.query(
                    "UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1 RETURNING numero_diario, cliente_nome", 
                    [pagamentoId.toString()]
                );
                
                console.log(`✅ Pagamento Pix ${pagamentoId} APROVADO!`);

                if (resultado.rows.length > 0) {
                    const pedido = resultado.rows[0];
                    io.emit('novo_pedido_kanban', { 
                        id: pedido.numero_diario, 
                        cliente: pedido.cliente_nome, 
                        status: 'Pendente Delivery' 
                    });
                }
            }
        }
    } catch (e) {}
});

app.get('/api/pagamento/pix/:id/status', async (req, res) => {
    try {
        const mpToken = (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'")).rows[0]?.valor;
        const pgtoInfo = await (await fetch(`https://api.mercadopago.com/v1/payments/${req.params.id}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })).json();
        if (pgtoInfo.status === 'approved') {
            await pool.query("UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1", [req.params.id.toString()]);
            res.json({ pago: true });
        } else res.json({ pago: false });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.post('/api/funil', async (req, res) => {
    try {
        if (!req.body.evento) return res.status(400).json({ erro: "Sem evento" });
        await pool.query("INSERT INTO funil_eventos (evento, produto_nome, sessao_id) VALUES ($1, $2, $3)", [req.body.evento, req.body.produto_nome || null, req.body.sessao_id || null]);
        res.status(201).json({ sucesso: true });
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

// ==========================================
// 🎧 WEBHOOK: OUVINDO E RESPONDENDO (MENSAGEM DE BOAS VINDAS BLINDADA)
// ==========================================
const conversasAtivas = new Map();

app.post('/api/whatsapp/webhook', async (req, res) => {
    // ⚠️ Importante: O webhook precisa de uma resposta rápida 200 OK para não travar a Evolution API
    res.status(200).send('OK');
    
    try {
        const payload = req.body;
        
        // 1. Verifica se o evento é de mensagem recebida
        if (!payload.event || payload.event.toUpperCase() !== 'MESSAGES_UPSERT') return;
        
        // 2. A Evolution manda dados como Array ou Objeto
        let msgData = Array.isArray(payload.data) ? payload.data[0] : payload.data;
        
        if (!msgData || !msgData.key) return; 
        
        // 3. Ignorar mensagens que a própria loja enviou
        if (msgData.key.fromMe) return; 

        const remoteJid = msgData.key.remoteJid;
        
        // 4. Ignorar Grupos e Status (Silencioso)
        if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') return;

        // 5. 🛑 O FILTRO DE TEXTO: Garantir que a pessoa mandou um texto real
        const mensagemConteudo = msgData.message;
        if (!mensagemConteudo) return; 
        
        // Verifica se existe texto normal ou texto respondendo outra mensagem
        let textoEncontrado = '';
        if (mensagemConteudo.conversation) {
            textoEncontrado = mensagemConteudo.conversation;
        } else if (mensagemConteudo.extendedTextMessage && mensagemConteudo.extendedTextMessage.text) {
            textoEncontrado = mensagemConteudo.extendedTextMessage.text;
        } else if (mensagemConteudo.ephemeralMessage && mensagemConteudo.ephemeralMessage.message && mensagemConteudo.ephemeralMessage.message.extendedTextMessage) {
            textoEncontrado = mensagemConteudo.ephemeralMessage.message.extendedTextMessage.text;
        }

        if (!textoEncontrado || textoEncontrado.trim() === '') {
             console.log(`🙈 Robô ignorou um áudio/figurinha/imagem de: ${remoteJid}`);
             return; 
        }

        console.log(`💬 WEBHOOK RECEBEU TEXTO DE: ${remoteJid}`);

        const agora = Date.now();
        const ultimaMensagem = conversasAtivas.get(remoteJid) || 0;
        
        // 6. 🛡️ TRAVA ANTI-SPAM (2 Horas)
        if (agora - ultimaMensagem < 2 * 60 * 60 * 1000) {
            console.log(`⏳ Cliente ${remoteJid} já recebeu saudação há pouco tempo. Silenciando robô.`);
            conversasAtivas.set(remoteJid, agora); 
            return; 
        }

        conversasAtivas.set(remoteJid, agora);

        // 7. Busca os textos salvos no banco
        const configQuery = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
        const config = configQuery.rows[0];

        if (config && config.msg_boas_vindas && config.msg_boas_vindas.trim() !== '') {
            const nomeCliente = msgData.pushName || 'Cliente';
            const textoResposta = config.msg_boas_vindas.replace(/{nome}/g, nomeCliente);

            const url = config.zap_url.trim().replace(/\/$/, "");
            const instanciaURL = encodeURIComponent(config.zap_instancia.trim());

            console.log(`✅ Robô ativado! Enviando saudação para ${nomeCliente} (${remoteJid})...`);

            setTimeout(() => {
                fetch(`${url}/message/sendText/${instanciaURL}`, {
                    method: 'POST',
                    headers: { 'apikey': config.zap_key.trim(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number: remoteJid, text: textoResposta })
                })
                .then(r => r.json())
                .then(resultado => {
                    if (resultado.key) console.log(`🚀 Saudação enviada com sucesso para ${nomeCliente}!`);
                    else console.log(`⚠️ Resultado estranho do envio:`, resultado);
                })
                .catch(err => console.error("⚠️ Falha de conexão ao enviar saudação:", err.message));
            }, 2000);
        } else {
            console.log("⚠️ O robô quis responder, mas a msg de Boas-Vindas está vazia no painel.");
        }
    } catch (e) {
        console.error("❌ Erro grave no Webhook do WhatsApp:", e);
    }
});

// ==========================================
// 🚀 ROTA: DISPARO MANUAL DE MARKETING (CRM)
// ==========================================
app.post('/api/whatsapp/disparo-manual', async (req, res) => {
    try {
        const { telefone, mensagem } = req.body;
        if (!telefone || !mensagem) return res.status(400).json({ erro: "Telefone e mensagem são obrigatórios." });

        const configQuery = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
        const config = configQuery.rows[0];

        if (!config || !config.zap_url || !config.zap_key || !config.zap_instancia) {
            return res.status(400).json({ erro: "WhatsApp não configurado no sistema." });
        }

        // Limpa o número e prepara para a Evolution API
        const telefoneLimpo = "55" + String(telefone).replace(/\D/g, '');
        const url = config.zap_url.trim().replace(/\/$/, "");
        const instanciaURL = encodeURIComponent(config.zap_instancia.trim());

        // Dispara a mensagem
        const response = await fetch(`${url}/message/sendText/${instanciaURL}`, {
            method: 'POST',
            headers: { 'apikey': config.zap_key.trim(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: telefoneLimpo, text: mensagem })
        });

        if (!response.ok) throw new Error("A Evolution API recusou o envio.");

        res.json({ sucesso: true });
    } catch (erro) {
        console.error("❌ Erro no disparo manual:", erro);
        res.status(500).json({ erro: "Falha de rede ao tentar enviar a mensagem." });
    }
});

// ==========================================
// 🏦 MÓDULO FINANCEIRO: ROTAS DA API (AUTOMATIZADO - V0.2)
// ==========================================

// 1. Resumo Inteligente (Cards do Dashboard Financeiro com Vendas Automáticas)
app.get('/api/financeiro/resumo', async (req, res) => {
    try {
        // Ignora a categoria 'movimentacao_interna' para não duplicar o saldo!
        const pagarQuery = await pool.query(`
            SELECT COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            LEFT JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Despesa' AND l.status = 'Pendente' 
            AND (c.dre_ref IS NULL OR c.dre_ref != 'movimentacao_interna')
            AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);

        const receberQuery = await pool.query(`
            SELECT COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            LEFT JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Receita' AND l.status = 'Pendente'
            AND (c.dre_ref IS NULL OR c.dre_ref != 'movimentacao_interna')
            AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);

        const entradasQuery = await pool.query(`SELECT COALESCE(SUM(l.valor), 0) as total FROM fin_lancamentos l LEFT JOIN fin_categorias c ON l.categoria_id = c.id WHERE l.tipo = 'Receita' AND l.status = 'Pago' AND (c.dre_ref IS NULL OR c.dre_ref != 'movimentacao_interna')`);
        const saidasQuery = await pool.query(`SELECT COALESCE(SUM(l.valor), 0) as total FROM fin_lancamentos l LEFT JOIN fin_categorias c ON l.categoria_id = c.id WHERE l.tipo = 'Despesa' AND l.status = 'Pago' AND (c.dre_ref IS NULL OR c.dre_ref != 'movimentacao_interna')`);
        
        const vendasTotalQuery = await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE status NOT ILIKE '%cancelad%'`);

        const faturamentoTotalPDV = parseFloat(vendasTotalQuery.rows[0].total);
        const saldoGeralSistemico = parseFloat(entradasQuery.rows[0].total) - parseFloat(saidasQuery.rows[0].total) + faturamentoTotalPDV;

        res.json({
            pagar: parseFloat(pagarQuery.rows[0].total),
            receber: parseFloat(receberQuery.rows[0].total),
            saldo: saldoGeralSistemico
        });
    } catch (e) {
        console.error("Erro no resumo financeiro:", e);
        res.status(500).json({ erro: "Erro ao carregar resumo financeiro" });
    }
});

// 2. Criar um Novo Lançamento (Nova Receita / Nova Despesa)
app.post('/api/financeiro/lancamentos', async (req, res) => {
    try {
        const { descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id } = req.body;
        const novoLancamento = await pool.query(`
            INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
        `, [descricao, valor, data_vencimento, status || 'Pendente', tipo, categoria_id || null, conta_id || null]);
        
        res.status(201).json({ sucesso: true, lancamento: novoLancamento.rows[0] });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao criar lançamento" });
    }
});

// 3. Buscar Lançamentos com Filtros Inteligentes (Data, Banco, Busca)
app.get('/api/financeiro/lancamentos', async (req, res) => {
    try {
        const { banco_id, data_inicio, data_fim, busca } = req.query;
        
        let query = `SELECT * FROM fin_lancamentos WHERE 1=1`;
        let params = [];
        let paramCount = 1;

        // Se escolheu um banco específico
        if (banco_id) {
            query += ` AND conta_id = $${paramCount}`;
            params.push(banco_id);
            paramCount++;
        }
        
        // Se escolheu data inicial
        if (data_inicio) {
            query += ` AND data_vencimento >= $${paramCount}`;
            params.push(data_inicio);
            paramCount++;
        }
        
        // Se escolheu data final
        if (data_fim) {
            query += ` AND data_vencimento <= $${paramCount}`;
            params.push(data_fim);
            paramCount++;
        }
        
        // Se digitou algo na barra de pesquisa
        if (busca) {
            query += ` AND descricao ILIKE $${paramCount}`;
            params.push(`%${busca}%`);
            paramCount++;
        }

        query += ` ORDER BY data_vencimento DESC LIMIT 200`; // Aumentamos o limite para 200 resultados
        
        const lista = await pool.query(query, params);
        res.json(lista.rows);
    } catch (e) {
        console.error("Erro ao buscar lançamentos:", e);
        res.status(500).json({ erro: "Erro ao buscar lançamentos" });
    }
});

// 3.5 Atualizar/Editar um Lançamento
app.put('/api/financeiro/lancamentos/:id', async (req, res) => {
    try {
        const { descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id } = req.body;
        await pool.query(`
            UPDATE fin_lancamentos 
            SET descricao = $1, valor = $2, data_vencimento = $3, status = $4, tipo = $5, categoria_id = $6, conta_id = $7
            WHERE id = $8
        `, [descricao, valor, data_vencimento, status, tipo, categoria_id || null, conta_id || null, req.params.id]);
        
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar lançamento" });
    }
});

// 4. Deletar Lançamento
app.delete('/api/financeiro/lancamentos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM fin_lancamentos WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao deletar lançamento" });
    }
});

// 5. Buscar Categorias (Plano de Contas)
app.get('/api/financeiro/categorias', async (req, res) => {
    try {
        const check = await pool.query('SELECT COUNT(*) FROM fin_categorias');
        if (parseInt(check.rows[0].count) < 19) {
            await pool.query('DELETE FROM fin_categorias');
            await pool.query(`
                INSERT INTO fin_categorias (nome, tipo, dre_ref) VALUES
                ('1.1. Receita Loja Física (Balcão/Mesa)', 'Receita', 'receita_bruta'),
                ('1.2. Receita Delivery (iFood, WhatsApp)', 'Receita', 'receita_bruta'),
                ('1.3. Receita de Eventos / Encomendas', 'Receita', 'receita_bruta'),
                ('2.1. Deduções: Impostos e Taxas (DAS, Cartão)', 'Despesa', 'deducoes'),
                ('2.2. CMV: Insumos e Bases (Leite, Açaí)', 'Despesa', 'cmv'),
                ('2.2. CMV: Embalagens', 'Despesa', 'cmv'),
                ('2.2. CMV: Revenda (Bebidas, Terceiros)', 'Despesa', 'cmv'),
                ('2.3. Despesas de Entrega (Motoboy/Logística)', 'Despesa', 'despesas_vendas'),
                ('3.1. Ocupação e Utilidades (Aluguel, Energia, Água)', 'Despesa', 'despesas_operacionais'),
                ('3.2. Pessoal (Pró-labore, Salários, Encargos)', 'Despesa', 'despesas_operacionais'),
                ('3.3. Marketing e Vendas (Anúncios, Gráfica)', 'Despesa', 'despesas_vendas'),
                ('3.4. Administrativo (Sistemas, Contador, Limpeza)', 'Despesa', 'despesas_operacionais'),
                ('3.5. Manutenção e Conservação (Máquinas)', 'Despesa', 'despesas_operacionais'),
                ('4.1. Investimentos: Máquinas e Obras', 'Despesa', 'investimentos'),
                ('4.2. Investimentos: Informática e Móveis', 'Despesa', 'investimentos'),
                ('5.1. Pagamento de Empréstimos e Juros', 'Despesa', 'nao_operacional'),
                ('5.2. Tarifas Bancárias', 'Despesa', 'despesas_financeiras'),
                ('5.3. Distribuição de Lucros', 'Despesa', 'distribuicao_lucros'),
                ('5.4. Aportes de Capital / Investimento', 'Receita', 'aporte_capital')
            `);
        }
        const lista = await pool.query('SELECT * FROM fin_categorias ORDER BY tipo DESC, nome ASC');
        res.json(lista.rows);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar categorias" });
    }
});

// 6. Relatório DRE Automatizado (Cruzando lançamentos manuais + vendas do PDV)
app.get('/api/financeiro/dre', async (req, res) => {
    try {
        // A) Busca despesas e receitas manuais do mês atual
        const query = `
            SELECT c.dre_ref, COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY c.dre_ref
        `;
        const resultado = await pool.query(query);
        
        // B) 🚀 AUTOMACÃO: Puxa o faturamento bruto real das vendas da sorveteria deste mês
        const vendasMesQuery = await pool.query(`
            SELECT COALESCE(SUM(valor_total), 0) as total 
            FROM vendas 
            WHERE status NOT ILIKE '%cancelad%'
            AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);
        const faturamentoAutomaticoMes = parseFloat(vendasMesQuery.rows[0].total);

        const dre = {
            receita_bruta: 0, deducoes: 0, cmv: 0, 
            despesas_vendas: 0, despesas_operacionais: 0, 
            investimentos: 0, despesas_financeiras: 0, 
            distribuicao_lucros: 0, outras_receitas: 0, nao_operacional: 0,
            aporte_capital: 0
        };

        resultado.rows.forEach(row => {
            if (dre[row.dre_ref] !== undefined) dre[row.dre_ref] = parseFloat(row.total);
        });

        // ⚡ Injeta automaticamente o faturamento do mês na linha de Receita Bruta do DRE
        dre.receita_bruta = dre.receita_bruta + faturamentoAutomaticoMes;
        dre.outras_receitas = dre.outras_receitas + dre.aporte_capital;

        // Cálculos Contábeis em Cascata
        dre.receita_liquida = dre.receita_bruta - dre.deducoes;
        dre.lucro_bruto = dre.receita_liquida - dre.cmv;
        
        const total_despesas = dre.despesas_operacionais + dre.despesas_vendas;
        dre.resultado_operacional = dre.lucro_bruto - total_despesas;
        
        dre.lucro_liquido = dre.resultado_operacional + dre.outras_receitas - (dre.despesas_financeiras + dre.nao_operacional + dre.distribuicao_lucros + dre.investimentos);

        res.json(dre);
    } catch (e) {
        console.error("Erro no DRE:", e);
        res.status(500).json({ erro: "Erro ao calcular DRE" });
    }
});

// 7. Gerenciar Contas Bancárias (Bancos) com Saldo Dinâmico Real
app.get('/api/financeiro/bancos', async (req, res) => {
    try {
        const checkLista = await pool.query('SELECT * FROM fin_contas_bancarias');
        if (checkLista.rows.length === 0) {
            await pool.query(`INSERT INTO fin_contas_bancarias (nome, saldo_inicial) VALUES ('Caixa Físico (Gaveta)', 0)`);
        }

        // Calcula o saldo somando entradas pagas e subtraindo saídas pagas em tempo real
        const querySaldos = `
            SELECT 
                b.id, b.nome, b.saldo_inicial,
                COALESCE(SUM(CASE WHEN l.tipo = 'Receita' AND l.status = 'Pago' THEN l.valor ELSE 0 END), 0) as entradas,
                COALESCE(SUM(CASE WHEN l.tipo = 'Despesa' AND l.status = 'Pago' THEN l.valor ELSE 0 END), 0) as saidas
            FROM fin_contas_bancarias b
            LEFT JOIN fin_lancamentos l ON b.id = l.conta_id
            GROUP BY b.id, b.nome, b.saldo_inicial
            ORDER BY b.id ASC
        `;
        
        const resultado = await pool.query(querySaldos);
        const bancosComSaldo = resultado.rows.map(banco => ({
            id: banco.id,
            nome: banco.nome,
            saldo_inicial: parseFloat(banco.saldo_inicial),
            saldo_atual: parseFloat(banco.saldo_inicial) + parseFloat(banco.entradas) - parseFloat(banco.saidas)
        }));

        res.json(bancosComSaldo);
    } catch (e) {
        console.error("Erro bancos:", e);
        res.status(500).json({ erro: "Erro ao buscar contas" });
    }
});

app.post('/api/financeiro/bancos', async (req, res) => {
    try {
        const novoBanco = await pool.query(`
            INSERT INTO fin_contas_bancarias (nome, saldo_inicial)
            VALUES ($1, $2) RETURNING *
        `, [req.body.nome, req.body.saldo_inicial || 0]);
        res.status(201).json({ sucesso: true, banco: novoBanco.rows[0] });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao criar conta bancária" });
    }
});

// 8. Atualizar/Editar Conta Bancária
app.put('/api/financeiro/bancos/:id', async (req, res) => {
    try {
        await pool.query('UPDATE fin_contas_bancarias SET nome = $1, saldo_inicial = $2 WHERE id = $3', [req.body.nome, req.body.saldo_inicial || 0, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar banco" });
    }
});

// 9. Deletar Conta Bancária
app.delete('/api/financeiro/bancos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM fin_contas_bancarias WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao deletar banco" });
    }
});

// 10. Atualizar/Editar Conta Bancária (Nome e Saldo Inicial)
app.put('/api/financeiro/bancos/:id', async (req, res) => {
    try {
        await pool.query('UPDATE fin_contas_bancarias SET nome = $1, saldo_inicial = $2 WHERE id = $3', [req.body.nome, req.body.saldo_inicial || 0, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar banco" });
    }
});

// 9. Dados para os Gráficos do Dashboard Financeiro
app.get('/api/financeiro/graficos', async (req, res) => {
    try {
        // 1. Receitas vs Despesas (Mês Atual)
        const despesasQuery = await pool.query(`SELECT COALESCE(SUM(valor), 0) as total FROM fin_lancamentos WHERE tipo = 'Despesa' AND EXTRACT(MONTH FROM data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)`);
        const receitasQuery = await pool.query(`SELECT COALESCE(SUM(valor), 0) as total FROM fin_lancamentos WHERE tipo = 'Receita' AND EXTRACT(MONTH FROM data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)`);
        const vendasQuery = await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE status NOT ILIKE '%cancelad%' AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)`);

        const totalReceitas = parseFloat(receitasQuery.rows[0].total) + parseFloat(vendasQuery.rows[0].total);
        const totalDespesas = parseFloat(despesasQuery.rows[0].total);

        // 2. Onde o dinheiro está indo? (Agrupado por Categoria do DRE)
        const despesasPorCategoria = await pool.query(`
            SELECT c.nome, SUM(l.valor) as total
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Despesa' AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY c.nome
            ORDER BY total DESC
        `);

        // 3. Canais de Venda (Qual origem dá mais dinheiro?)
        const canaisQuery = await pool.query(`
            SELECT origem, SUM(valor_total) as total
            FROM vendas
            WHERE status NOT ILIKE '%cancelad%' AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY origem
            ORDER BY total DESC
        `);

        res.json({
            resumo_mes: { receitas: totalReceitas, despesas: totalDespesas },
            despesas_pizza: despesasPorCategoria.rows,
            canais_venda: canaisQuery.rows
        });
    } catch (e) {
        console.error("Erro nos gráficos:", e);
        res.status(500).json({ erro: "Erro ao carregar dados dos gráficos" });
    }
});

// 11. Relatório de Fluxo de Caixa (Panorama Realizado e Previsto - 12 Meses)
app.get('/api/financeiro/fluxo-caixa', async (req, res) => {
    try {
        // Busca vendas REAIS (sem cancelamentos)
        const vendasQuery = await pool.query(`
            SELECT TO_CHAR(data_hora, 'YYYY-MM') as mes, COALESCE(SUM(valor_total), 0) as total
            FROM vendas 
            WHERE status NOT ILIKE '%cancelad%'
            GROUP BY mes
        `);

        // Busca despesas e receitas, e traz o status junto para o filtro inteligente
        const lancamentosQuery = await pool.query(`
            SELECT TO_CHAR(l.data_vencimento, 'YYYY-MM') as mes, c.dre_ref, c.tipo, l.status, COALESCE(SUM(l.valor), 0) as total
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            GROUP BY mes, c.dre_ref, c.tipo, l.status
        `);

        // Gera o esqueleto de 12 meses: 5 meses passados + Mês Atual + 6 meses no futuro
        const meses = [];
        for (let i = -5; i <= 6; i++) {
            const d = new Date();
            d.setMonth(d.getMonth() + i);
            const ano = d.getFullYear();
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            meses.push(`${ano}-${mes}`);
        }

        // Descobre qual é o mês atual para separar o Realizado do Previsto
        const dataAtual = new Date();
        const mesAtualStr = `${dataAtual.getFullYear()}-${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;

        // Consolida a matemática mês a mês
        const fluxoCaixa = meses.map(mes => {
            const vendasMes = parseFloat(vendasQuery.rows.find(v => v.mes === mes)?.total || 0);
            const lancamentosMes = lancamentosQuery.rows.filter(l => l.mes === mes);
            
            let receitas_manuais = 0;
            let cmv = 0, desp_op = 0, desp_vendas = 0, impostos = 0, financeiras = 0, investimentos = 0;

            lancamentosMes.forEach(l => {
                // REGRA DE OURO: Se o mês já passou, só conta o que foi 'Pago'. Se é atual ou futuro, conta tudo (Previsto)
                if (mes < mesAtualStr && l.status !== 'Pago') return;

                // 🛑 MÁGICA: IGNORA TRANSFERÊNCIAS INTERNAS E FECHAMENTOS PARA NÃO DUPLICAR ENTRADA!
                if (l.dre_ref === 'movimentacao_interna') return;

                const valor = parseFloat(l.total);
                if (l.tipo === 'Receita') receitas_manuais += valor;
                if (l.tipo === 'Despesa') {
                    if (l.dre_ref === 'cmv') cmv += valor;
                    else if (l.dre_ref === 'despesas_operacionais') desp_op += valor;
                    else if (l.dre_ref === 'despesas_vendas') desp_vendas += valor;
                    else if (l.dre_ref === 'deducoes') impostos += valor;
                    else if (l.dre_ref === 'investimentos') investimentos += valor;
                    else financeiras += valor; 
                }
            });

            const receita_total = vendasMes + receitas_manuais;
            const despesa_total = cmv + desp_op + desp_vendas + impostos + financeiras + investimentos;

            return {
                mes,
                receita_vendas: vendasMes,
                receitas_manuais,
                receita_total,
                cmv, desp_op, desp_vendas, impostos, financeiras, investimentos,
                despesa_total,
                saldo_mes: receita_total - despesa_total
            };
        });

        res.json(fluxoCaixa);
    } catch (e) {
        console.error("Erro no Fluxo de Caixa:", e);
        res.status(500).json({ erro: "Erro ao gerar fluxo de caixa" });
    }
});

// 12. Executar Transferência entre Contas com Dedução de Taxas (Auditoria)
app.post('/api/financeiro/transferencias', async (req, res) => {
    try {
        const { conta_origem_id, conta_destino_id, valor_bruto, taxa, descricao } = req.body;
        
        const vBruto = parseFloat(valor_bruto);
        const vTaxa = parseFloat(taxa) || 0;
        const vLiquido = vBruto - vTaxa;
        const dataAtual = new Date().toISOString().split('T')[0];

        // 1. Procura ou cria a categoria de movimentação interna (para o DRE ignorar o saldo principal)
        let catResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'movimentacao_interna' LIMIT 1");
        if (catResult.rows.length === 0) {
            catResult = await pool.query("INSERT INTO fin_categorias (nome, tipo, dre_ref) VALUES ('Transferência / Fechamento', 'Receita', 'movimentacao_interna') RETURNING id");
        }
        const categoriaInternaId = catResult.rows[0].id;

        // 2. Procura a categoria de taxas (Deduções) para computar a taxa no DRE oficialmente
        let catTaxaResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'deducoes' LIMIT 1");
        const categoriaTaxaId = catTaxaResult.rows[0]?.id || null;

        // Inicia a transação de segurança no banco de dados
        await pool.query('BEGIN');

        // A) Lança a saída do valor bruto da conta de origem (Ignorado pelo DRE)
        await pool.query(`
            INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
            VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)
        `, [`[Saída Transferência] ${descricao}`, vBruto, dataAtual, categoriaInternaId, conta_origem_id]);

        // B) Lança a entrada do valor líquido na conta de destino (Ignorado pelo DRE)
        await pool.query(`
            INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
            VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)
        `, [`[Entrada Transferência] ${descricao}`, vLiquido, dataAtual, categoriaInternaId, conta_destino_id]);

        // C) Se houver taxa, lança como uma Despesa de taxa na conta de origem (Computado no DRE!)
        if (vTaxa > 0 && categoriaTaxaId) {
            await pool.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)
            `, [`[Taxa Maquininha] ${descricao}`, vTaxa, dataAtual, categoriaTaxaId, conta_origem_id]);
        }

        await pool.query('COMMIT');
        res.json({ sucesso: true });
    } catch (e) {
        await pool.query('ROLLBACK');
        console.error("Erro na transferência:", e);
        res.status(500).json({ erro: "Erro ao processar transferência" });
    }
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => console.log(`🚀 Servidor Icesoft v5.0 (com WebSockets) na porta ${PORTA}!`));
