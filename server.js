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
            CREATE TABLE IF NOT EXISTS vendas (
                id SERIAL PRIMARY KEY, produto_nome VARCHAR(255) DEFAULT 'Pedido Diversos',
                valor_total DECIMAL(10,2), forma_pagamento VARCHAR(50), itens JSONB DEFAULT '[]',
                data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status VARCHAR(50) DEFAULT 'Concluída',
                cliente_nome VARCHAR(100), cliente_telefone VARCHAR(20), cliente_endereco TEXT,
                origem VARCHAR(50) DEFAULT 'Balcão'
            );
            CREATE TABLE IF NOT EXISTS configuracoes (chave VARCHAR(50) PRIMARY KEY, valor TEXT NOT NULL);
            INSERT INTO configuracoes (chave, valor) VALUES ('status_delivery', 'aberto') ON CONFLICT (chave) DO NOTHING;
            CREATE TABLE IF NOT EXISTS bairros (id SERIAL PRIMARY KEY, nome VARCHAR(100) NOT NULL, taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00);
            CREATE TABLE IF NOT EXISTS mesas_ativas (
                id SERIAL PRIMARY KEY, numero VARCHAR(10) NOT NULL, itens JSONB DEFAULT '[]',
                status VARCHAR(20) DEFAULT 'Ocupada', data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS origem VARCHAR(50) DEFAULT 'Balcão';
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
// ROTA DE VENDAS (ATUALIZADA COM FILTRO DE DATA!)
// ==========================================
app.get('/api/vendas', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let querySql = 'SELECT * FROM vendas';
        let params = [];

        // Se o frontend enviar datas, o motor aplica o filtro
        if (inicio && fim) {
            querySql += ' WHERE data_hora::date BETWEEN $1 AND $2';
            params = [inicio, fim];
        }

        querySql += ' ORDER BY data_hora DESC';
        const resultado = await pool.query(querySql, params);
        res.json(resultado.rows);
    } catch (e) { 
        console.error("Erro ao buscar vendas:", e);
        res.status(500).json({ erro: "Erro ao buscar vendas" }); 
    }
});

app.post('/api/vendas', async (req, res) => { 
    try { 
        const { produto_nome, valor_total, total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem } = req.body;
        const valorFinal = valor_total || total || 0;
        const origemFinal = origem || 'Balcão';
        
        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, 
            [produto_nome, valorFinal, forma_pagamento, JSON.stringify(itens || []), status || 'Concluída', cliente_nome, cliente_telefone, cliente_endereco, origemFinal]
        ); 
        res.status(201).json({ sucesso: true }); 
    } catch (e) { 
        console.error("Erro ao salvar venda:", e);
        res.status(500).json({erro:"Erro"}); 
    }
});

// ==========================================
// RESTANTE DAS ROTAS (MESAS, CAIXA, PRODUTOS...)
// ==========================================
app.get('/api/status', (req, res) => res.json({ mensagem: "✅ Motor v5.0 pronto para Relatórios!" }));

// (Aqui continuam todas as suas outras rotas de mesas, caixa, produtos, etc...)
// Vou manter o padrão para não ocupar espaço, mas você deve manter as que já funcionam no seu arquivo.
app.get('/api/mesas', async (req, res) => { try { res.json((await pool.query('SELECT * FROM mesas_ativas ORDER BY numero ASC')).rows); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.get('/api/caixa/status', async (req, res) => { try { res.json((await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1')).rows[0] || { status: 'Fechado' }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.get('/api/produtos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM produtos ORDER BY id ASC')).rows.map(p => ({...p, preco: parseFloat(p.preco)}))); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/grupos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/bairros', async (req, res) => { try { res.json((await pool.query('SELECT * FROM bairros ORDER BY nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});

// Iniciando Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft v5.0 ligado na porta ${PORTA}!`);
});
