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

// 1. Configuração de Segurança (Permissão total para Vercel)
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 2. Limite de Tamanho de Arquivos (Até 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 3. Libera o acesso público para as fotos do cardápio
app.use('/uploads', express.static('/app/uploads'));

// 4. Configuração do Motor de Uploads (Multer)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = '/app/uploads';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
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

// Teste de conexão e criação de TODAS as tabelas vitais
pool.connect()
    .then(() => {
        console.log('☁️ Banco de Dados PostgreSQL Conectado!');
        return pool.query(`
            -- 1. Tabela de Vendas (Kanban)
            CREATE TABLE IF NOT EXISTS vendas (
                id SERIAL PRIMARY KEY,
                produto_nome VARCHAR(255) DEFAULT 'Pedido Diversos',
                valor_total DECIMAL(10,2),
                forma_pagamento VARCHAR(50),
                itens JSONB DEFAULT '[]',
                data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(50) DEFAULT 'Concluída',
                cliente_nome VARCHAR(100),
                cliente_telefone VARCHAR(20),
                cliente_endereco TEXT
            );
            
            -- 2. Tabela de Configurações (Cores e Status da Loja)
            CREATE TABLE IF NOT EXISTS configuracoes (
                chave VARCHAR(50) PRIMARY KEY,
                valor TEXT NOT NULL
            );
            INSERT INTO configuracoes (chave, valor) VALUES ('status_delivery', 'aberto') ON CONFLICT (chave) DO NOTHING;

            -- 3. Tabela de Bairros e Taxas
            CREATE TABLE IF NOT EXISTS bairros (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00
            );
            
            -- 4. Garantia da foto no Produto
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
        if (!req.file) {
            return res.status(400).json({ sucesso: false, erro: "Nenhuma imagem foi enviada." });
        }
        const urlImagem = `/uploads/${req.file.filename}`;
        res.json({ sucesso: true, url: urlImagem });
    } catch (erro) {
        console.error("Erro no upload:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao salvar a imagem." });
    }
});

// ==========================================
// DEMAIS ROTAS DA API
// ==========================================

app.get('/status', (req, res) => {
    res.json({ mensagem: "✅ Motor da Icesoft rodando perfeitamente nas Nuvens!" });
});

app.get('/api/produtos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM produtos ORDER BY id ASC');
        const produtosFormatados = resultado.rows.map(p => ({
            ...p,
            preco: parseFloat(p.preco)
        }));
        res.json(produtosFormatados);
    } catch (erro) {
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
});

app.post('/api/produtos', async (req, res) => {
    const { nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url } = req.body;
    const grupos = grupos_ids || []; 
    const cat = categoria || 'Outros';
    try {
        const querySql = 'INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *';
        const resultado = await pool.query(querySql, [nome, descricao, preco, emoji, cat, grupos, imagem_url]);
        res.json({ sucesso: true, produto: resultado.rows[0] });
    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: "Erro ao salvar no banco de dados" });
    }
});

app.put('/api/produtos/:id', async (req, res) => {
    const { id } = req.params; 
    const { nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url } = req.body;
    const grupos = grupos_ids || [];
    const cat = categoria || 'Outros';
    try {
        const querySql = 'UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6, imagem_url = $7 WHERE id = $8 RETURNING *';
        const resultado = await pool.query(querySql, [nome, descricao, preco, emoji, cat, grupos, imagem_url, id]);
        res.json({ sucesso: true, produto: resultado.rows[0] });
    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: "Erro ao atualizar no banco de dados" });
    }
});

app.delete('/api/produtos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const resultado = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING *', [id]);
        if (resultado.rowCount > 0) res.json({ sucesso: true, mensagem: "Produto excluído!" });
        else res.status(404).json({ sucesso: false, erro: "Produto não encontrado" });
    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: "Erro ao excluir do banco de dados" });
    }
});

app.put('/api/produtos/:id/status', async (req, res) => {
    const { id } = req.params;
    const { ativo } = req.body; 
    try {
        await pool.query('UPDATE produtos SET ativo = $1 WHERE id = $2', [ativo, id]);
        res.json({ sucesso: true, mensagem: "Status atualizado!" });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar status" });
    }
});

// Grupos
app.get('/api/grupos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC');
        res.json(resultado.rows);
    } catch (erro) { res.status(500).json({ erro: "Erro ao buscar grupos" }); }
});
app.post('/api/grupos', async (req, res) => {
    const { nome, limite, itens } = req.body;
    const itensFormatados = itens ? JSON.stringify(itens) : '[]';
    try {
        const resultado = await pool.query('INSERT INTO grupos_adicionais (nome, limite, itens) VALUES ($1, $2, $3) RETURNING *', [nome, limite, itensFormatados]);
        res.json({ sucesso: true, grupo: resultado.rows[0] });
    } catch (erro) { res.status(500).json({ erro: "Erro ao criar grupo" }); }
});
app.put('/api/grupos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, limite, itens } = req.body;
    const itensFormatados = itens ? JSON.stringify(itens) : '[]';
    try {
        const resultado = await pool.query('UPDATE grupos_adicionais SET nome = $1, limite = $2, itens = $3 WHERE id = $4 RETURNING *', [nome, limite, itensFormatados, id]);
        res.json({ sucesso: true, grupo: resultado.rows[0] });
    } catch (erro) { res.status(500).json({ erro: "Erro ao atualizar grupo" }); }
});
app.delete('/api/grupos/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM grupos_adicionais WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (erro) { res.status(500).json({ erro: "Erro ao excluir grupo" }); }
});
app.put('/api/grupos/:id/status', async (req, res) => {
    try {
        await pool.query('UPDATE grupos_adicionais SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]);
        res.json({ sucesso: true });
    } catch (erro) { res.status(500).json({ erro: "Erro ao atualizar status" }); }
});

// Categorias e Bairros
app.get('/api/categorias', async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC')).rows); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.post('/api/categorias', async (req, res) => {
    try { res.json({ sucesso: true, categoria: (await pool.query('INSERT INTO categorias (nome, ordem) VALUES ($1, $2) RETURNING *', [req.body.nome, req.body.ordem || 0])).rows[0] }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.delete('/api/categorias/:id', async (req, res) => {
    try { await pool.query('DELETE FROM categorias WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});

app.get('/api/bairros', async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM bairros ORDER BY nome ASC')).rows); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.post('/api/bairros', async (req, res) => {
    try { res.json((await pool.query('INSERT INTO bairros (nome, taxa) VALUES ($1, $2) RETURNING *', [req.body.nome, req.body.taxa])).rows[0]); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.delete('/api/bairros/:id', async (req, res) => {
    try { await pool.query('DELETE FROM bairros WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});

// Configurações da Loja
app.get('/api/loja/status', async (req, res) => {
    try { res.json({ status: (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'status_delivery'")).rows[0]?.valor || 'aberto' }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.put('/api/loja/status', async (req, res) => {
    try { await pool.query("UPDATE configuracoes SET valor = $1 WHERE chave = 'status_delivery'", [req.body.status]); res.json({ sucesso: true }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.get('/api/configuracoes', async (req, res) => {
    try {
        const configs = {};
        (await pool.query("SELECT * FROM configuracoes")).rows.forEach(r => configs[r.chave] = r.valor);
        res.json(configs);
    } catch (e) { res.status(500).json({ erro: "Erro" }); }
});

// Vendas / Kanban
app.post('/api/vendas', async (req, res) => {
    const { produto_nome, valor_total, total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco } = req.body;
    try {
        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [produto_nome, valor_total || total || 0, forma_pagamento, itens, status || 'Concluída', cliente_nome, cliente_telefone, cliente_endereco]
        );
        res.status(201).json({ sucesso: true });
    } catch (e) { res.status(500).json({ erro: e.message }); }
});
app.put('/api/vendas/:id/status', async (req, res) => {
    try { await pool.query("UPDATE vendas SET status = $1 WHERE id = $2", [req.body.status, req.params.id]); res.json({ sucesso: true }); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});
app.get('/api/vendas', async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM vendas ORDER BY data_hora DESC')).rows); } 
    catch (e) { res.status(500).json({ erro: "Erro" }); }
});

// Iniciando Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft ligado na porta ${PORTA}`);
});
