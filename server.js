// Importando as peças do motor
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // ⬅️ O novo "motorista" do Banco de Dados

const app = express();
app.use(cors()); 
app.use(express.json());

// ==========================================
// 1. CONEXÃO COM O BANCO DE DADOS NA NUVEM (NEON)
// ==========================================
const pool = new Pool({
    // A chave mestra que você criou
    connectionString: 'postgresql://neondb_owner:npg_w2HdxUFe0EXA@ep-crimson-violet-amb5wph0.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

// Teste de conexão logo ao ligar a chave
pool.connect()
    .then(() => console.log('☁️ Banco de Dados PostgreSQL Conectado com Sucesso!'))
    .catch(err => console.error('❌ Erro ao conectar no banco:', err));


// ==========================================
// 2. ROTAS (A API DO SISTEMA)
// ==========================================

// Rota de Status
app.get('/status', (req, res) => {
    res.json({ mensagem: "✅ Motor da Icesoft rodando perfeitamente nas Nuvens!" });
});

// ROTA 1: Ler produtos da Nuvem (Para PDV e Cardápio)
app.get('/api/produtos', async (req, res) => {
    try {
        // Vai no banco e pega tudo da tabela 'produtos'
        const resultado = await pool.query('SELECT * FROM produtos ORDER BY id ASC');
        
        // O Neon as vezes devolve os números como texto, garantimos que seja número:
        const produtosFormatados = resultado.rows.map(p => ({
            ...p,
            preco: parseFloat(p.preco)
        }));
        
        res.json(produtosFormatados);
    } catch (erro) {
        console.error("Erro ao buscar produtos:", erro);
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
});

// ROTA 2: Salvar Venda com Itens na Nuvem
app.post('/api/vendas', async (req, res) => {
    const novaVenda = req.body;
    const codigoVenda = "VD-" + Math.floor(Math.random() * 10000);
    
    try {
        const comandoSql = `
            INSERT INTO vendas (codigo_venda, valor_total, forma_pagamento, status, itens) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *;
        `;
        // Agora enviamos também o JSON.stringify(novaVenda.itens)
        const valores = [codigoVenda, novaVenda.valor, novaVenda.formaPagamento, "Concluída", JSON.stringify(novaVenda.itens)];
        
        const resultado = await pool.query(comandoSql, valores);
        console.log(`💰 VENDA COM ITENS SALVA! Código: ${resultado.rows[0].codigo_venda}`);
        res.status(201).json({ mensagem: "Venda processada!", id: codigoVenda });
        
    } catch (erro) {
        console.error("Erro ao salvar:", erro);
        res.status(500).json({ erro: "Erro no banco" });
    }
});

// ROTA 3: Ler Vendas da Nuvem (Para o Dashboard no futuro)
app.get('/api/vendas', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM vendas ORDER BY data_hora DESC');
        res.json(resultado.rows);
    } catch (erro) {
        console.error("Erro ao buscar vendas:", erro);
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
});

// ROTA 4: Gerar Ranking de Mais Vendidos (Inteligência)
app.get('/api/ranking', async (req, res) => {
    try {
        // Esta "mágica" SQL abre os pacotes JSON e conta quantos de cada nome existem
        const querySql = `
            SELECT item->>'nome' as nome, COUNT(*) as quantidade
            FROM vendas, jsonb_array_elements(itens) AS item
            GROUP BY nome
            ORDER BY quantidade DESC
            LIMIT 5;
        `;
        const resultado = await pool.query(querySql);
        res.json(resultado.rows);
    } catch (erro) {
        console.error(erro);
        res.status(500).send("Erro ao gerar ranking");
    }
});

// ==========================================
// ROTA 5: Sistema de Login e Segurança
// ==========================================
app.post('/api/login', async (req, res) => {
    const { username, senha } = req.body;

    try {
        // Busca no banco se existe alguém com esse nome e senha
        const querySql = 'SELECT * FROM usuarios WHERE username = $1 AND senha = $2';
        const resultado = await pool.query(querySql, [username, senha]);

        if (resultado.rows.length > 0) {
            const usuarioLogado = resultado.rows[0];
            console.log(`🔐 Acesso Liberado para: ${usuarioLogado.username}`);
            
            // Cria um "crachá" simples para devolver ao navegador
            res.json({ 
                sucesso: true, 
                mensagem: "Login aprovado", 
                token: "cracha-icesoft-aprovado",
                cargo: usuarioLogado.cargo
            });
        } else {
            console.log(`🚫 Tentativa de invasão bloqueada! Usuário: ${username}`);
            res.status(401).json({ sucesso: false, erro: "Usuário ou senha incorretos!" });
        }
    } catch (erro) {
        console.error("Erro no sistema de login:", erro);
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
});

// ==========================================
// ROTA: Adicionar Novo Produto (CREATE)
// ==========================================
app.post('/api/produtos', async (req, res) => {
    const { nome, descricao, preco, emoji } = req.body;

    try {
        const querySql = 'INSERT INTO produtos (nome, descricao, preco, emoji) VALUES ($1, $2, $3, $4) RETURNING *';
        const resultado = await pool.query(querySql, [nome, descricao, preco, emoji]);
        
        console.log(`📦 Novo produto cadastrado: ${nome}`);
        res.json({ sucesso: true, produto: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao cadastrar produto:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao salvar no banco de dados" });
    }
});

// ==========================================
// ROTA: Editar Produto Existente (UPDATE)
// ==========================================
app.put('/api/produtos/:id', async (req, res) => {
    const { id } = req.params; // Pega o ID do produto na URL
    const { nome, descricao, preco, emoji } = req.body;

    try {
        const querySql = 'UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4 WHERE id = $5 RETURNING *';
        const resultado = await pool.query(querySql, [nome, descricao, preco, emoji, id]);
        
        console.log(`✏️ Produto atualizado: ${nome}`);
        res.json({ sucesso: true, produto: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao editar produto:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao atualizar no banco de dados" });
    }
});

// ==========================================
// 3. LIGANDO A IGNIÇÃO (Preparado para Nuvem)
// ==========================================
// A nuvem injeta a própria porta no 'process.env.PORT'. Se não tiver, usa a 3000.
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft ligado na porta ${PORTA}`);
});