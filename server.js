// ==========================================
// PEÇAS DO MOTOR E CONFIGURAÇÕES
// ==========================================
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const pastaUploads = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(pastaUploads));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync(pastaUploads)){ fs.mkdirSync(pastaUploads, { recursive: true }); }
        cb(null, pastaUploads);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==========================================
// CONEXÃO COM O BANCO DE DADOS NA NUVEM (NEON)
// ==========================================
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_w2HdxUFe0EXA@ep-crimson-violet-amb5wph0.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

pool.connect()
    .then(() => {
        console.log('☁️ Banco de Dados PostgreSQL Conectado!');
        return pool.query(`
            -- Vendas
            CREATE TABLE IF NOT EXISTS vendas (
                id SERIAL PRIMARY KEY, produto_nome VARCHAR(255) DEFAULT 'Pedido Diversos',
                valor_total DECIMAL(10,2), forma_pagamento VARCHAR(50), itens JSONB DEFAULT '[]',
                data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status VARCHAR(50) DEFAULT 'Concluída',
                cliente_nome VARCHAR(100), cliente_telefone VARCHAR(20), cliente_endereco TEXT
            );
            -- Configurações
            CREATE TABLE IF NOT EXISTS configuracoes (chave VARCHAR(50) PRIMARY KEY, valor TEXT NOT NULL);
            INSERT INTO configuracoes (chave, valor) VALUES ('status_delivery', 'aberto') ON CONFLICT (chave) DO NOTHING;
            -- Bairros e Mesas
            CREATE TABLE IF NOT EXISTS bairros (id SERIAL PRIMARY KEY, nome VARCHAR(100) NOT NULL, taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00);
            CREATE TABLE IF NOT EXISTS mesas_ativas (
                id SERIAL PRIMARY KEY, numero VARCHAR(10) NOT NULL, itens JSONB DEFAULT '[]',
                status VARCHAR(20) DEFAULT 'Ocupada', data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagem_url TEXT;
        `);
    })
    .then(() => console.log("📦 Estrutura do Banco 100% Blindada e Pronta!"))
    .catch(err => console.error('❌ Erro no banco:', err));

// ==========================================
// ROTA MÁGICA DE UPLOAD
// ==========================================
app.post('/api/upload', upload.single('imagem'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ sucesso: false, erro: "Nenhuma imagem foi enviada." });
        res.json({ sucesso: true, url: `/uploads/${req.file.filename}` });
    } catch (erro) { res.status(500).json({ sucesso: false, erro: "Erro ao salvar a imagem." }); }
});

// ==========================================
// ROTAS DO SISTEMA DE LOGIN E RANKING (Restauradas!)
// ==========================================
app.post('/api/login', async (req, res) => {
    const { username, senha } = req.body;
    try {
        const resultado = await pool.query('SELECT * FROM usuarios WHERE username = $1 AND senha = $2', [username, senha]);
        if (resultado.rows.length > 0) {
            res.json({ sucesso: true, mensagem: "Login aprovado", token: "cracha-icesoft-aprovado", cargo: resultado.rows[0].cargo });
        } else {
            res.status(401).json({ sucesso: false, erro: "Usuário ou senha incorretos!" });
        }
    } catch (erro) { res.status(500).json({ erro: "Erro interno do servidor" }); }
});

app.get('/api/ranking', async (req, res) => {
    try {
        const querySql = `
            SELECT item->>'nome' as nome, COUNT(*) as quantidade
            FROM vendas, jsonb_array_elements(itens) AS item
            GROUP BY nome ORDER BY quantidade DESC LIMIT 5;
        `;
        res.json((await pool.query(querySql)).rows);
    } catch (erro) { res.status(500).send("Erro ao gerar ranking"); }
});

// ==========================================
// ROTAS DE CAIXA (Restauradas!)
// ==========================================
app.get('/api/caixa/status', async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1')).rows[0] || { status: 'Fechado' }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.post('/api/caixa/abrir', async (req, res) => {
    try { res.json({ sucesso: true, caixa: (await pool.query("INSERT INTO controle_caixa (valor_inicial, status) VALUES ($1, 'Aberto') RETURNING *", [req.body.valor_inicial || 0])).rows[0] }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.put('/api/caixa/fechar/:id', async (req, res) => {
    try { res.json({ sucesso: true, caixa: (await pool.query("UPDATE controle_caixa SET status = 'Fechado', data_fechamento = CURRENT_TIMESTAMP, valor_informado = $1, valor_sistema = $2 WHERE id = $3 RETURNING *", [req.body.valor_informado || 0, req.body.valor_sistema || 0, req.params.id])).rows[0] }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.post('/api/caixa/movimentacao', async (req, res) => {
    try { res.json({ sucesso: true, movimentacao: (await pool.query("INSERT INTO movimentacoes_caixa (caixa_id, tipo, valor, motivo) VALUES ($1, $2, $3, $4) RETURNING *", [req.body.caixa_id, req.body.tipo, req.body.valor, req.body.motivo])).rows[0] }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.get('/api/caixa/resumo/:id', async (req, res) => {
    try {
        const caixa = (await pool.query('SELECT * FROM controle_caixa WHERE id = $1', [req.params.id])).rows[0];
        if (!caixa) return res.status(404).json({ erro: "Caixa não encontrado" });
        const vendasDinheiro = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total_vendas FROM vendas WHERE LOWER(TRIM(forma_pagamento)) = 'dinheiro' AND data_hora >= $1`, [caixa.data_abertura])).rows[0].total_vendas) || 0;
        const movs = (await pool.query(`SELECT tipo, COALESCE(SUM(valor), 0) as total FROM movimentacoes_caixa WHERE caixa_id = $1 GROUP BY tipo`, [req.params.id])).rows;
        let suprimentos = 0, sangrias = 0;
        movs.forEach(r => { if (r.tipo === 'Suprimento') suprimentos = parseFloat(r.total); if (r.tipo === 'Sangria') sangrias = parseFloat(r.total); });
        res.json({ fundo: parseFloat(caixa.valor_inicial) || 0, vendas_dinheiro: vendasDinheiro, suprimentos, sangrias, esperado: (parseFloat(caixa.valor_inicial) || 0) + vendasDinheiro + suprimentos - sangrias });
    } catch (e) { res.status(500).json({ erro: "Erro Técnico" }); }
});

// ==========================================
// ROTAS DE MESAS E COMANDAS (Restauradas!)
// ==========================================
app.get('/api/mesas', async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM mesas_ativas ORDER BY numero ASC')).rows); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.post('/api/mesas', async (req, res) => {
    try { res.status(201).json((await pool.query("INSERT INTO mesas_ativas (numero, itens) VALUES ($1, $2) RETURNING *", [req.body.numero, JSON.stringify(req.body.itens || [])])).rows[0]); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.put('/api/mesas/:id', async (req, res) => {
    try { res.json((await pool.query("UPDATE mesas_ativas SET itens = $1 WHERE id = $2 RETURNING *", [JSON.stringify(req.body.itens), req.params.id])).rows[0]); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.delete('/api/mesas/:id', async (req, res) => {
    try { await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});

// ==========================================
// DEMAIS ROTAS (Produtos, Configs, etc)
// ==========================================
app.get('/api/status', (req, res) => res.json({ mensagem: "✅ Motor rodando!" }));
app.get('/api/produtos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM produtos ORDER BY id ASC')).rows.map(p => ({...p, preco: parseFloat(p.preco)}))); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/produtos', async (req, res) => { try { res.json({ sucesso: true, produto: (await pool.query('INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [req.body.nome, req.body.descricao, req.body.preco, req.body.emoji, req.body.categoria || 'Outros', req.body.grupos_ids || [], req.body.imagem_url])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/produtos/:id', async (req, res) => { try { res.json({ sucesso: true, produto: (await pool.query('UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6, imagem_url = $7 WHERE id = $8 RETURNING *', [req.body.nome, req.body.descricao, req.body.preco, req.body.emoji, req.body.categoria || 'Outros', req.body.grupos_ids || [], req.body.imagem_url, req.params.id])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/produtos/:id', async (req, res) => { try { await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/produtos/:id/status', async (req, res) => { try { await pool.query('UPDATE produtos SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/grupos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/grupos', async (req, res) => { try { res.json({ sucesso: true, grupo: (await pool.query('INSERT INTO grupos_adicionais (nome, limite, itens) VALUES ($1, $2, $3) RETURNING *', [req.body.nome, req.body.limite, req.body.itens ? JSON.stringify(req.body.itens) : '[]'])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/grupos/:id', async (req, res) => { try { res.json({ sucesso: true, grupo: (await pool.query('UPDATE grupos_adicionais SET nome = $1, limite = $2, itens = $3 WHERE id = $4 RETURNING *', [req.body.nome, req.body.limite, req.body.itens ? JSON.stringify(req.body.itens) : '[]', req.params.id])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/grupos/:id', async (req, res) => { try { await pool.query('DELETE FROM grupos_adicionais WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/grupos/:id/status', async (req, res) => { try { await pool.query('UPDATE grupos_adicionais SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/categorias', async (req, res) => { try { res.json((await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/categorias', async (req, res) => { try { res.json({ sucesso: true, categoria: (await pool.query('INSERT INTO categorias (nome, ordem) VALUES ($1, $2) RETURNING *', [req.body.nome, req.body.ordem || 0])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/categorias/:id', async (req, res) => { try { await pool.query('DELETE FROM categorias WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/bairros', async (req, res) => { try { res.json((await pool.query('SELECT * FROM bairros ORDER BY nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/bairros', async (req, res) => { try { res.json((await pool.query('INSERT INTO bairros (nome, taxa) VALUES ($1, $2) RETURNING *', [req.body.nome, req.body.taxa])).rows[0]); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/bairros/:id', async (req, res) => { try { await pool.query('DELETE FROM bairros WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/loja/status', async (req, res) => { try { res.json({ status: (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'status_delivery'")).rows[0]?.valor || 'aberto' }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/loja/status', async (req, res) => { try { await pool.query("UPDATE configuracoes SET valor = $1 WHERE chave = 'status_delivery'", [req.body.status]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/configuracoes', async (req, res) => { try { const configs = {}; (await pool.query("SELECT * FROM configuracoes")).rows.forEach(r => configs[r.chave] = r.valor); res.json(configs); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.post('/api/vendas', async (req, res) => { try { await pool.query(`INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [req.body.produto_nome, req.body.valor_total || req.body.total || 0, req.body.forma_pagamento, req.body.itens, req.body.status || 'Concluída', req.body.cliente_nome, req.body.cliente_telefone, req.body.cliente_endereco]); res.status(201).json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/vendas/:id/status', async (req, res) => { try { await pool.query("UPDATE vendas SET status = $1 WHERE id = $2", [req.body.status, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/vendas', async (req, res) => { try { res.json((await pool.query('SELECT * FROM vendas ORDER BY data_hora DESC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});

// Iniciando Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft ligado na porta ${PORTA} com TODAS as peças no lugar!`);
});
