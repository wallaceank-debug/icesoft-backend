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

// ATUALIZAÇÃO DA TABELA PARA SUPORTAR O KANBAN
pool.query(`
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Concluída';
`).then(() => console.log("📦 Tabela de vendas blindada com Status!")).catch(console.error);

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
        const resultado = await pool.query('SELECT * FROM produtos ORDER BY id ASC');
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

// ROTA DE SALVAR VENDAS (PDV E DELIVERY)
app.post('/api/vendas', async (req, res) => {
    // Puxamos as variáveis do celular
    const { produto_nome, valor_total, total, forma_pagamento, itens, status } = req.body;
    
    // Pega o valor correto independente de como o PDV ou Celular mandaram
    const valorFinal = valor_total || total || 0;
    const statusFinal = status || 'Concluída'; 
    
    try {
        // CORREÇÃO: Voltamos a usar a coluna "valor_total" que o seu banco já conhece perfeitamente!
        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status) 
             VALUES ($1, $2, $3, $4, $5)`,
            [produto_nome, valorFinal, forma_pagamento, itens, statusFinal]
        );
        res.status(201).json({ sucesso: true });
    } catch (erro) {
        console.error("Erro ao salvar venda:", erro);
        res.status(500).json({ erro: "Erro interno no servidor" });
    }
});

// ==========================================
// KANBAN: ATUALIZAR STATUS DO PEDIDO
// ==========================================
app.put('/api/vendas/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await pool.query("UPDATE vendas SET status = $1 WHERE id = $2", [status, id]);
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao atualizar status:", e);
        res.status(500).json({ erro: "Erro ao atualizar status no banco" });
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
        const querySql = 'SELECT * FROM usuarios WHERE username = $1 AND senha = $2';
        const resultado = await pool.query(querySql, [username, senha]);

        if (resultado.rows.length > 0) {
            const usuarioLogado = resultado.rows[0];
            console.log(`🔐 Acesso Liberado para: ${usuarioLogado.username}`);
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
    const { nome, descricao, preco, emoji, categoria, grupos_ids } = req.body;
    const grupos = grupos_ids || []; 
    const cat = categoria || 'Outros';

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
// ROTA: Editar Produto Existente (UPDATE)
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
    const { id } = req.params;
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
// ROTAS: GRUPOS DE ADICIONAIS
// ==========================================
app.get('/api/grupos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC');
        res.json(resultado.rows);
    } catch (erro) {
        console.error("Erro ao buscar grupos:", erro);
        res.status(500).json({ erro: "Erro ao buscar grupos" });
    }
});

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
// ROTAS: CATEGORIAS 
// ==========================================
app.get('/api/categorias', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC');
        res.json(resultado.rows);
    } catch (erro) {
        console.error("Erro ao buscar categorias:", erro);
        res.status(500).json({ erro: "Erro ao buscar categorias" });
    }
});

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
// ROTAS DE STATUS (LIGA/DESLIGA)
// ==========================================
app.put('/api/produtos/:id/status', async (req, res) => {
    const { id } = req.params;
    const { ativo } = req.body; 
    try {
        await pool.query('UPDATE produtos SET ativo = $1 WHERE id = $2', [ativo, id]);
        res.json({ sucesso: true, mensagem: "Status do produto atualizado!" });
    } catch (erro) {
        console.error("Erro ao mudar status do produto:", erro);
        res.status(500).json({ erro: "Erro ao atualizar status" });
    }
});

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
app.get('/api/caixa/status', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1');
        res.json(resultado.rows[0] || { status: 'Fechado' });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar caixa" });
    }
});

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

app.put('/api/caixa/fechar/:id', async (req, res) => {
    const { id } = req.params;
    const { valor_informado, valor_sistema } = req.body;
    try {
        const sql = "UPDATE controle_caixa SET status = 'Fechado', data_fechamento = CURRENT_TIMESTAMP, valor_informado = $1, valor_sistema = $2 WHERE id = $3 RETURNING *";
        const resultado = await pool.query(sql, [valor_informado || 0, valor_sistema || 0, id]);
        res.json({ sucesso: true, caixa: resultado.rows[0] });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao fechar caixa" });
    }
});

app.post('/api/caixa/movimentacao', async (req, res) => {
    const { caixa_id, tipo, valor, motivo } = req.body;
    try {
        const sql = "INSERT INTO movimentacoes_caixa (caixa_id, tipo, valor, motivo) VALUES ($1, $2, $3, $4) RETURNING *";
        const resultado = await pool.query(sql, [caixa_id, tipo, valor, motivo]);
        res.json({ sucesso: true, movimentacao: resultado.rows[0] });
    } catch (erro) {
        console.error("Erro ao salvar movimentacao:", erro);
        res.status(500).json({ erro: "Erro ao registrar movimentação" });
    }
});

// 5. Calcular o Resumo do Caixa para a Conferência (VERSÃO BANCO DE DADOS NATIVO)
app.get('/api/caixa/resumo/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Pega os dados do caixa
        const caixaRes = await pool.query('SELECT * FROM controle_caixa WHERE id = $1', [id]);
        if (caixaRes.rows.length === 0) return res.status(404).json({ erro: "Caixa não encontrado" });

        const caixa = caixaRes.rows[0];
        const valorInicial = parseFloat(caixa.valor_inicial) || 0;
        const dataAbertura = caixa.data_abertura; // Deixa a data crua do banco!

        // 2. Manda o Banco de Dados somar as Vendas (Imune a fusos horários!)
        // Ele vai ignorar letras maiúsculas/minúsculas garantindo que 'Dinheiro' seja encontrado
        const sqlVendas = `
            SELECT COALESCE(SUM(valor_total), 0) as total_vendas
            FROM vendas
            WHERE LOWER(TRIM(forma_pagamento)) = 'dinheiro'
            AND data_hora >= $1
        `;
        const vendasRes = await pool.query(sqlVendas, [dataAbertura]);
        const vendasDinheiro = parseFloat(vendasRes.rows[0].total_vendas) || 0;

        // 3. Manda o Banco de Dados somar as Movimentações
        const sqlMov = `
            SELECT tipo, COALESCE(SUM(valor), 0) as total
            FROM movimentacoes_caixa
            WHERE caixa_id = $1
            GROUP BY tipo
        `;
        const movRes = await pool.query(sqlMov, [id]);
        let suprimentos = 0;
        let sangrias = 0;
        movRes.rows.forEach(r => {
            if (r.tipo === 'Suprimento') suprimentos = parseFloat(r.total);
            if (r.tipo === 'Sangria') sangrias = parseFloat(r.total);
        });

        // 4. A Matemática Final
        const esperado = valorInicial + vendasDinheiro + suprimentos - sangrias;

        res.json({
            fundo: valorInicial,
            vendas_dinheiro: vendasDinheiro,
            suprimentos: suprimentos,
            sangrias: sangrias,
            esperado: esperado
        });
    } catch (erro) {
        console.error("Erro no Resumo:", erro);
        res.status(500).json({ erro: "Erro Técnico: " + String(erro.message || erro) });
    }
});

// ==========================================
// ROTAS DE MESAS E COMANDAS
// ==========================================

// 1. Criar a tabela automaticamente caso não exista
pool.query(`
    CREATE TABLE IF NOT EXISTS mesas_ativas (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(10) NOT NULL,
        itens JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'Ocupada',
        data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).then(() => console.log("📦 Tabela de Mesas verificada!")).catch(console.error);

// 2. Listar todas as mesas abertas
app.get('/api/mesas', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM mesas_ativas ORDER BY numero ASC');
        res.json(resultado.rows);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao buscar mesas" });
    }
});

// 3. Abrir nova mesa
app.post('/api/mesas', async (req, res) => {
    const { numero, itens } = req.body;
    try {
        const sql = "INSERT INTO mesas_ativas (numero, itens) VALUES ($1, $2) RETURNING *";
        const resultado = await pool.query(sql, [numero, JSON.stringify(itens || [])]);
        res.status(201).json(resultado.rows[0]);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao abrir mesa" });
    }
});

// 4. Atualizar itens de uma mesa
app.put('/api/mesas/:id', async (req, res) => {
    const { id } = req.params;
    const { itens } = req.body;
    try {
        const sql = "UPDATE mesas_ativas SET itens = $1 WHERE id = $2 RETURNING *";
        const resultado = await pool.query(sql, [JSON.stringify(itens), id]);
        res.json(resultado.rows[0]);
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao atualizar mesa" });
    }
});

// 5. Fechar a mesa (Excluir após pagamento total)
app.delete('/api/mesas/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // Agora com o ID perfeitamente linkado para o banco não se perder!
        await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [id]);
        res.json({ sucesso: true });
    } catch (erro) {
        console.error("Erro ao fechar mesa:", erro);
        res.status(500).json({ erro: "Erro ao fechar mesa" });
    }
});

// ==========================================
// STATUS DA LOJA (LIGA/DESLIGA CARDÁPIO)
// ==========================================

// 1. Cria a tabela e garante que a coluna "valor" suporte textos gigantes (TEXT)
pool.query(`
    CREATE TABLE IF NOT EXISTS configuracoes (
        chave VARCHAR(50) PRIMARY KEY,
        valor TEXT NOT NULL
    );
    -- A MÁGICA: Se a tabela já existir com tamanho pequeno, nós esticamos ela para TEXT!
    ALTER TABLE configuracoes ALTER COLUMN valor TYPE TEXT;
    
    INSERT INTO configuracoes (chave, valor) VALUES ('status_delivery', 'aberto') ON CONFLICT (chave) DO NOTHING;
`).then(() => console.log("📦 Tabela de Configurações atualizada para suporte a textos longos!")).catch(console.error);

// 2. Rota para o cliente (e PDV) perguntar se a loja está aberta
app.get('/api/loja/status', async (req, res) => {
    try {
        const result = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'status_delivery'");
        res.json({ status: result.rows[0] ? result.rows[0].valor : 'aberto' });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar status" });
    }
});

// 3. Rota para o PDV mandar fechar ou abrir a loja
app.put('/api/loja/status', async (req, res) => {
    const { status } = req.body; 
    try {
        await pool.query("UPDATE configuracoes SET valor = $1 WHERE chave = 'status_delivery'", [status]);
        res.json({ sucesso: true, status });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar status" });
    }
});

// 4. Buscar todas as configurações da loja (Cores, Nome, etc)
app.get('/api/configuracoes', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM configuracoes");
        const configs = {};
        // Transforma a lista do banco em um objeto fácil do Javascript ler
        result.rows.forEach(row => configs[row.chave] = row.valor);
        res.json(configs);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar configurações" });
    }
});

// 5. Salvar várias configurações de uma vez (Painel Delivery)
app.put('/api/configuracoes', async (req, res) => {
    const configs = req.body; // Recebe os dados do seu painel
    try {
        // Percorre cada configuração e salva/atualiza no banco
        for (const [chave, valor] of Object.entries(configs)) {
            await pool.query(
                `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                [chave, valor]
            );
        }
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao salvar configurações" });
    }
});

// ==========================================
// 3. LIGANDO A IGNIÇÃO (Preparado para Nuvem)
// ==========================================
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft ligado na porta ${PORTA}`);
});
