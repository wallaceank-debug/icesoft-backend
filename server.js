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
// ROTA: Adicionar Novo Produto (CREATE) - ATUALIZADO V2
// ==========================================
app.post('/api/produtos', async (req, res) => {
    // Adicionamos a 'categoria' na porta de entrada
    const { nome, descricao, preco, emoji, categoria, grupos_ids } = req.body;
    const grupos = grupos_ids || []; 
    const cat = categoria || 'Outros'; // Proteção anti-vazio

    try {
        const querySql = 'INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *';
        const resultado = await pool.query(querySql, [nome, descricao, preco, emoji, cat, grupos]);
        
        res.json({ sucesso: true, produto: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao cadastrar produto:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao salvar no banco de dados" });
    }
});

// ==========================================
// ROTA: Editar Produto Existente (UPDATE) - ATUALIZADO V2
// ==========================================
app.put('/api/produtos/:id', async (req, res) => {
    const { id } = req.params; 
    const { nome, descricao, preco, emoji, categoria, grupos_ids } = req.body;
    const grupos = grupos_ids || [];
    const cat = categoria || 'Outros';

    try {
        const querySql = 'UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6 WHERE id = $7 RETURNING *';
        const resultado = await pool.query(querySql, [nome, descricao, preco, emoji, cat, grupos, id]);
        
        res.json({ sucesso: true, produto: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao editar produto:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao atualizar no banco de dados" });
    }
});

// ==========================================
// ROTA: Excluir Produto Existente (DELETE)
// ==========================================
app.delete('/api/produtos/:id', async (req, res) => {
    const { id } = req.params; // Pega o ID do produto que veio na URL

    try {
        const querySql = 'DELETE FROM produtos WHERE id = $1 RETURNING *';
        const resultado = await pool.query(querySql, [id]);
        
        if (resultado.rowCount > 0) {
            console.log(`🗑️ Produto excluído com sucesso ID: ${id}`);
            res.json({ sucesso: true, mensagem: "Produto excluído!" });
        } else {
            res.status(404).json({ sucesso: false, erro: "Produto não encontrado" });
        }
    } catch (erro) {
        console.error("Erro ao excluir produto:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao excluir do banco de dados" });
    }
});

// ==========================================
// ROTAS: GRUPOS DE ADICIONAIS (Modificadores)
// ==========================================

// 1. Listar todos os Grupos
app.get('/api/grupos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC');
        res.json(resultado.rows);
    } catch (erro) {
        console.error("Erro ao buscar grupos:", erro);
        res.status(500).json({ erro: "Erro ao buscar grupos" });
    }
});

// 2. Criar novo Grupo
app.post('/api/grupos', async (req, res) => {
    const { nome, limite, itens } = req.body;
    const itensFormatados = itens ? JSON.stringify(itens) : '[]';
    
    try {
        const sql = 'INSERT INTO grupos_adicionais (nome, limite, itens) VALUES ($1, $2, $3) RETURNING *';
        const resultado = await pool.query(sql, [nome, limite, itensFormatados]);
        res.json({ sucesso: true, grupo: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao criar grupo:", erro);
        res.status(500).json({ erro: "Erro ao criar grupo" });
    }
});

// 3. Atualizar Grupo
app.put('/api/grupos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, limite, itens } = req.body;
    const itensFormatados = itens ? JSON.stringify(itens) : '[]';
    
    try {
        const sql = 'UPDATE grupos_adicionais SET nome = $1, limite = $2, itens = $3 WHERE id = $4 RETURNING *';
        const resultado = await pool.query(sql, [nome, limite, itensFormatados, id]);
        res.json({ sucesso: true, grupo: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao atualizar grupo:", erro);
        res.status(500).json({ erro: "Erro ao atualizar grupo" });
    }
});

// 4. Excluir Grupo
app.delete('/api/grupos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM grupos_adicionais WHERE id = $1', [id]);
        res.json({ sucesso: true, mensagem: "Grupo excluído!" });
    } catch (erro) {
        console.error("Erro ao excluir grupo:", erro);
        res.status(500).json({ erro: "Erro ao excluir grupo" });
    }
});

// ==========================================
// ROTAS: CATEGORIAS (Para o filtro do PDV)
// ==========================================

// 1. Listar todas as Categorias (Ordenadas pela coluna 'ordem')
app.get('/api/categorias', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC');
        res.json(resultado.rows);
    } catch (erro) {
        console.error("Erro ao buscar categorias:", erro);
        res.status(500).json({ erro: "Erro ao buscar categorias" });
    }
});

// 2. Criar nova Categoria
app.post('/api/categorias', async (req, res) => {
    const { nome, ordem } = req.body;
    try {
        const sql = 'INSERT INTO categorias (nome, ordem) VALUES ($1, $2) RETURNING *';
        const resultado = await pool.query(sql, [nome, ordem || 0]);
        res.json({ sucesso: true, categoria: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao criar categoria:", erro);
        res.status(500).json({ erro: "Erro ao criar categoria" });
    }
});

// 3. Atualizar Categoria
app.put('/api/categorias/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, ordem } = req.body;
    try {
        const sql = 'UPDATE categorias SET nome = $1, ordem = $2 WHERE id = $3 RETURNING *';
        const resultado = await pool.query(sql, [nome, ordem || 0, id]);
        res.json({ sucesso: true, categoria: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao atualizar categoria:", erro);
        res.status(500).json({ erro: "Erro ao atualizar categoria" });
    }
});

// 4. Excluir Categoria
app.delete('/api/categorias/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
        res.json({ sucesso: true, mensagem: "Categoria excluída!" });
    } catch (erro) {
        console.error("Erro ao excluir categoria:", erro);
        res.status(500).json({ erro: "Erro ao excluir categoria" });
    }
});

// ==========================================
// ROTAS DE STATUS (LIGA/DESLIGA - CHAVINHAS)
// ==========================================

// 1. Ligar/Desligar Produto
app.put('/api/produtos/:id/status', async (req, res) => {
    const { id } = req.params;
    const { ativo } = req.body; // Recebe true (ligado) ou false (desligado)
    try {
        await pool.query('UPDATE produtos SET ativo = $1 WHERE id = $2', [ativo, id]);
        res.json({ sucesso: true, mensagem: "Status do produto atualizado!" });
    } catch (erro) {
        console.error("Erro ao mudar status do produto:", erro);
        res.status(500).json({ erro: "Erro ao atualizar status" });
    }
});

// 2. Ligar/Desligar Grupo de Adicionais
app.put('/api/grupos/:id/status', async (req, res) => {
    const { id } = req.params;
    const { ativo } = req.body;
    try {
        await pool.query('UPDATE grupos_adicionais SET ativo = $1 WHERE id = $2', [ativo, id]);
        res.json({ sucesso: true, mensagem: "Status do grupo atualizado!" });
    } catch (erro) {
        console.error("Erro ao mudar status do grupo:", erro);
        res.status(500).json({ erro: "Erro ao atualizar status" });
    }
});

// ==========================================
// ROTAS DE CONTROLE DE CAIXA
// ==========================================

// 1. Ver status atual do caixa (Sempre pega o último criado)
app.get('/api/caixa/status', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1');
        // Se não tiver nenhum, devolve "Fechado"
        res.json(resultado.rows[0] || { status: 'Fechado' });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar caixa" });
    }
});

// 2. Abrir o Caixa
app.post('/api/caixa/abrir', async (req, res) => {
    const { valor_inicial } = req.body;
    try {
        const sql = "INSERT INTO controle_caixa (valor_inicial, status) VALUES ($1, 'Aberto') RETURNING *";
        const resultado = await pool.query(sql, [valor_inicial || 0]);
        res.json({ sucesso: true, caixa: resultado.rows[0] });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao abrir caixa" });
    }
});

// 3. Fechar o Caixa
app.put('/api/caixa/fechar/:id', async (req, res) => {
    const { id } = req.params;
    const { valor_informado } = req.body;
    try {
        const sql = "UPDATE controle_caixa SET status = 'Fechado', data_fechamento = CURRENT_TIMESTAMP, valor_informado = $1 WHERE id = $2 RETURNING *";
        const resultado = await pool.query(sql, [valor_informado || 0, id]);
        res.json({ sucesso: true, caixa: resultado.rows[0] });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao fechar caixa" });
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
