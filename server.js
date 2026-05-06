// ==========================================
// PEÇAS DO MOTOR E CONFIGURAÇÕES
// ==========================================
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); // 🚀 NOVO: O nosso triturador e compressor de imagens!

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

// 🚀 NOVO SISTEMA DE UPLOAD COM COMPRESSÃO (SHARP)
// Em vez de salvar no HD direto, seguramos a foto na memória RAM rapidinho
const storage = multer.memoryStorage(); 
const upload = multer({ storage: storage });

// ==========================================
// ROTA MÁGICA DE UPLOAD E COMPRESSÃO
// ==========================================
app.post('/api/upload', upload.single('imagem'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ sucesso: false, erro: "Nenhuma imagem foi enviada." });

        // Cria o nome único do arquivo, mas agora SEMPRE forçando o formato final ser .webp
        const nomeArquivo = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
        const caminhoFinal = path.join(pastaUploads, nomeArquivo);

        // Garante que a pasta 'uploads' existe antes de tentar salvar algo lá
        if (!fs.existsSync(pastaUploads)){ fs.mkdirSync(pastaUploads, { recursive: true }); }

        // 🪄 A MÁGICA DA COMPRESSÃO ACONTECE AQUI
        await sharp(req.file.buffer)
            .rotate() // 🚀 CORREÇÃO: Lê o EXIF do celular e desvira a foto automaticamente!
            .resize({ 
                width: 600, 
                height: 600, 
                fit: 'inside', // Garante que a imagem caiba numa caixa 600x600 sem cortar pedaços
                withoutEnlargement: true // Se a foto original for pequenininha (ex: 200px), ele não estica pra não perder qualidade
            }) 
            .webp({ quality: 80 }) // Converte para formato WebP retendo 80% da qualidade visual (perfeito para telas)
            .toFile(caminhoFinal); // Após processar na RAM, joga o arquivo levinho pro HD do servidor

        res.json({ sucesso: true, url: `/uploads/${nomeArquivo}` });
    } catch (erro) { 
        console.error("Erro na compressão de imagem:", erro);
        res.status(500).json({ sucesso: false, erro: "Erro ao comprimir e salvar a imagem." }); 
    }
});

// ==========================================
// CONEXÃO COM O BANCO DE DADOS NA NUVEM (NEON)
// ==========================================
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_w2HdxUFe0EXA@ep-crimson-violet-amb5wph0.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

// ==========================================
// 🛠️ ATUALIZAÇÃO AUTOMÁTICA DO BANCO DE DADOS
// ==========================================
pool.query(`
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS numero_diario INTEGER DEFAULT 0;
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_diaria DATE DEFAULT CURRENT_DATE;
`).catch(e => console.log("Aviso ao atualizar banco:", e));

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
            
            CREATE TABLE IF NOT EXISTS cidades (id SERIAL PRIMARY KEY, nome VARCHAR(100) UNIQUE NOT NULL);
            CREATE TABLE IF NOT EXISTS bairros (id SERIAL PRIMARY KEY, nome VARCHAR(100) NOT NULL, taxa DECIMAL(10,2) NOT NULL DEFAULT 0.00);
            ALTER TABLE bairros ADD COLUMN IF NOT EXISTS cidade VARCHAR(100) DEFAULT 'Quatis';
            
            CREATE TABLE IF NOT EXISTS mesas_ativas (
                id SERIAL PRIMARY KEY, numero VARCHAR(10) NOT NULL, itens JSONB DEFAULT '[]',
                status VARCHAR(20) DEFAULT 'Ocupada', data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS categorias (
                id SERIAL PRIMARY KEY, nome TEXT, ordem INTEGER
            );

            -- 🚀 NOVO: Tabela de Usuários e Chave Mestra
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY, 
                username VARCHAR(100) UNIQUE, 
                senha VARCHAR(100), 
                cargo VARCHAR(50) DEFAULT 'admin'
            );

            -- 🛡️ FORÇA a criação da coluna de e-mail caso a tabela seja velha
            ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email VARCHAR(255);

            -- Agora sim, cria a chave mestra com total segurança
            INSERT INTO usuarios (username, senha, email, cargo) 
            VALUES ('admin', 'icesoft123', 'admin@icesoft.com', 'admin') 
            ON CONFLICT (username) DO NOTHING;

            -- Alterações de atualização para tabelas existentes
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS origem VARCHAR(50) DEFAULT 'Balcão';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagem_url TEXT;
            ALTER TABLE grupos_adicionais ADD COLUMN IF NOT EXISTS obrigatorio BOOLEAN DEFAULT false;
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS observacoes TEXT;
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS venda_por_peso BOOLEAN DEFAULT false;
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tag VARCHAR(50);
            
            -- 🚀 NOVO: Promoções e Visibilidade
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo_promocao VARCHAR(50) DEFAULT 'nenhuma';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS valor_promocao DECIMAL(10,2) DEFAULT 0;
            ALTER TABLE categorias ADD COLUMN IF NOT EXISTS mostrar_cardapio BOOLEAN DEFAULT true;
            -- 🚀 NOVO: Rastreio de Transações Externas (Mercado Pago)
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS transacao_id VARCHAR(100);
        `);
    })
    .then(() => console.log("📦 Estrutura do Banco 100% Blindada e Pronta!"))
    .catch(err => console.error('❌ Erro no banco:', err));


// ==========================================
// ROTA DE VENDAS (ATUALIZADA COM FILTRO DE DATA!)
// ==========================================
app.get('/api/vendas', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let querySql = 'SELECT * FROM vendas';
        let params = [];

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

// ==========================================
// 📝 CRIAR NOVA VENDA (COM SENHA DIÁRIA)
// ==========================================
app.post('/api/vendas', async (req, res) => { 
    try { 
        const { produto_nome, valor_total, total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id } = req.body;
        const valorFinal = valor_total || total || 0;
        const origemFinal = origem || 'Balcão';
        
        // 🚀 MÁGICA DA SENHA DIÁRIA: Conta quantos pedidos já houveram HOJE e soma +1
        const queryDiario = await pool.query("SELECT COALESCE(MAX(numero_diario), 0) + 1 AS proximo FROM vendas WHERE data_diaria = CURRENT_DATE");
        const numeroDiario = queryDiario.rows[0].proximo;

        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id, numero_diario, data_diaria) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE)`, 
            [produto_nome, valorFinal, forma_pagamento, JSON.stringify(itens || []), status || 'Concluída', cliente_nome, cliente_telefone, cliente_endereco, origemFinal, observacoes || '', transacao_id || null, numeroDiario]
        ); 
        res.status(201).json({ sucesso: true }); 
    } catch (e) { 
        console.error("Erro ao salvar venda:", e);
        res.status(500).json({erro:"Erro ao salvar venda"}); 
    }
});

// ==========================================
// ROTA DE MUDANÇA DE STATUS + DISPARO DE WHATSAPP
// ==========================================
app.put('/api/vendas/:id/status', async (req, res) => { 
    try { 
        const novoStatus = req.body.status;
        const idVenda = req.params.id;

        // 1. Atualiza o status no Banco de Dados
        await pool.query("UPDATE vendas SET status = $1 WHERE id = $2", [novoStatus, idVenda]); 
        res.json({ sucesso: true }); // Libera a tela do Kanban rapidamente

        // 2. 🤖 INÍCIO DA AUTOMAÇÃO DO ROBÔ DE MENSAGENS 🤖
        const vendaQuery = await pool.query("SELECT * FROM vendas WHERE id = $1", [idVenda]);
        const venda = vendaQuery.rows[0];

        // Só tenta enviar se for um pedido de Delivery com telefone preenchido
        if (venda && venda.cliente_telefone && venda.cliente_telefone.trim() !== '') {
            
            const configQuery = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
            const config = configQuery.rows[0];

            if (config && config.zap_url && config.zap_key && config.zap_instancia) {
                let textoMensagem = null;

                // 3. Escolhe a gaveta certa dependendo da coluna do Kanban
                if (novoStatus === 'A Preparar' && config.msg_aceito) {
                    textoMensagem = config.msg_aceito;
                } else if (novoStatus === 'Saiu p/ Entrega' && config.msg_entrega) {
                    textoMensagem = config.msg_entrega;
                } else if (novoStatus === 'Entregue' && config.msg_concluido) {
                    textoMensagem = config.msg_concluido;
                }

                if (textoMensagem) {
                    // 4. Limpeza e Formatação Mágica
                    const primeiroNome = venda.cliente_nome ? venda.cliente_nome.split(' ')[0] : 'Cliente';
                    
                    let textoPronto = textoMensagem
                        .replace(/{nome}/g, primeiroNome)
                        .replace(/{pedido}/g, venda.id);

                    // 🚀 A MÁGICA DO RECIBO: Anexa o resumo completo quando o pedido é aceito
                    if (novoStatus === 'A Preparar') {
                        let resumo = `\n\n*🛒 Resumo do seu pedido:*\n`;
                        
                        try {
                            const itens = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens;
                            itens.forEach(item => {
                                resumo += `▪️ 1x ${item.nome.replace('Delivery: ', '')} - R$ ${Number(item.preco).toFixed(2).replace('.', ',')}\n`;
                            });
                        } catch(e) {}
                        
                        resumo += `\n*💰 Total:* R$ ${Number(venda.valor_total).toFixed(2).replace('.', ',')}`;
                        resumo += `\n*💳 Pagamento:* ${venda.forma_pagamento}`;
                        
                        if (venda.cliente_endereco && !venda.cliente_endereco.includes('Retirada')) {
                            resumo += `\n*📍 Entrega:* ${venda.cliente_endereco}`;
                        } else {
                            resumo += `\n*🏬 Retirada na Loja*`;
                        }
                        
                        if (venda.observacoes && venda.observacoes.trim() !== '') {
                            resumo += `\n*📝 Obs:* ${venda.observacoes}`;
                        }

                        textoPronto += resumo;
                    }

                    // Limpa o telefone (tira os parênteses e espaços) e adiciona o '55' do Brasil
                    const telefoneLimpo = "55" + venda.cliente_telefone.replace(/\D/g, '');

                    // 5. Manda a ordem de disparo para a Evolution API
                    const url = config.zap_url.trim().replace(/\/$/, "");
                    const instanciaURL = encodeURIComponent(config.zap_instancia.trim());

                    fetch(`${url}/message/sendText/${instanciaURL}`, {
                        method: 'POST',
                        headers: {
                            'apikey': config.zap_key.trim(),
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            number: telefoneLimpo,
                            text: textoPronto
                        })
                    }).catch(err => console.error("⚠️ Robô falhou ao enviar mensagem:", err));
                }
            }
        }
    } catch (e) { 
        console.error("Erro na rota de status:", e);
    }
});
// ==========================================
// ROTAS DO SISTEMA DE LOGIN E RANKING
// ==========================================
app.post('/api/login', async (req, res) => {
    const { username, senha } = req.body;
    try {
        // Tenta achar alguém com esse username e senha ou email e senha
        const resultado = await pool.query(
            'SELECT * FROM usuarios WHERE (username = $1 OR email = $1) AND senha = $2', 
            [username, senha]
        );
        
        if (resultado.rows.length > 0) {
            // Se achou, entrega o crachá com um token dinâmico
            res.json({ 
                sucesso: true, 
                mensagem: "Login aprovado", 
                token: "cracha-icesoft-aprovado-" + Date.now(), 
                cargo: resultado.rows[0].cargo,
                usuario_id: resultado.rows[0].id // Mandamos a ID para poder mudar a senha depois
            });
        } else {
            res.status(401).json({ sucesso: false, erro: "Usuário ou senha incorretos!" });
        }
    } catch (erro) { 
        console.error(erro);
        res.status(500).json({ erro: "Erro interno do servidor" }); 
    }
});

// A NOVA Rota para Mudar os Dados (Senha/Email)
app.put('/api/usuarios/:id', async (req, res) => {
    const userId = req.params.id;
    const { novo_username, novo_email, nova_senha } = req.body;

    try {
        // Pega os dados atuais do usuário para não apagar o que ele não preencheu
        const userAtual = await pool.query('SELECT * FROM usuarios WHERE id = $1', [userId]);
        if (userAtual.rows.length === 0) return res.status(404).json({ erro: "Usuário não encontrado" });

        const user = userAtual.rows[0];
        
        const usernameFinal = novo_username || user.username;
        const emailFinal = novo_email || user.email;
        const senhaFinal = nova_senha || user.senha; 

        // Atualiza a tabela com as novas credenciais
        await pool.query(
            'UPDATE usuarios SET username = $1, email = $2, senha = $3 WHERE id = $4',
            [usernameFinal, emailFinal, senhaFinal, userId]
        );

        res.json({ sucesso: true, mensagem: "Dados atualizados com sucesso!" });

    } catch (erro) {
        console.error("Erro ao atualizar usuário:", erro);
        res.status(500).json({ erro: "Erro ao atualizar os dados." });
    }
});

// A sua rota de Ranking mantida intacta
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
// ROTAS DE CAIXA
// ==========================================
app.get('/api/caixa/status', async (req, res) => { try { res.json((await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1')).rows[0] || { status: 'Fechado' }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/caixa/abrir', async (req, res) => { try { res.json({ sucesso: true, caixa: (await pool.query("INSERT INTO controle_caixa (valor_inicial, status) VALUES ($1, 'Aberto') RETURNING *", [req.body.valor_inicial || 0])).rows[0] }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.put('/api/caixa/fechar/:id', async (req, res) => { try { res.json({ sucesso: true, caixa: (await pool.query("UPDATE controle_caixa SET status = 'Fechado', data_fechamento = CURRENT_TIMESTAMP, valor_informado = $1, valor_sistema = $2 WHERE id = $3 RETURNING *", [req.body.valor_informado || 0, req.body.valor_sistema || 0, req.params.id])).rows[0] }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/caixa/movimentacao', async (req, res) => { try { res.json({ sucesso: true, movimentacao: (await pool.query("INSERT INTO movimentacoes_caixa (caixa_id, tipo, valor, motivo) VALUES ($1, $2, $3, $4) RETURNING *", [req.body.caixa_id, req.body.tipo, req.body.valor, req.body.motivo])).rows[0] }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
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
// ROTAS DE MESAS E COMANDAS
// ==========================================
app.get('/api/mesas', async (req, res) => { try { res.json((await pool.query('SELECT * FROM mesas_ativas ORDER BY numero ASC')).rows); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/mesas', async (req, res) => { try { res.status(201).json((await pool.query("INSERT INTO mesas_ativas (numero, itens) VALUES ($1, $2) RETURNING *", [req.body.numero, JSON.stringify(req.body.itens || [])])).rows[0]); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.put('/api/mesas/:id', async (req, res) => { try { res.json((await pool.query("UPDATE mesas_ativas SET itens = $1 WHERE id = $2 RETURNING *", [JSON.stringify(req.body.itens), req.params.id])).rows[0]); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.delete('/api/mesas/:id', async (req, res) => { try { await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

// ==========================================
// DEMAIS ROTAS (Produtos, Configs, Bairros, etc)
// ==========================================
app.get('/api/status', (req, res) => res.json({ mensagem: "✅ Motor v5.0 pronto para Relatórios!" }));
app.get('/api/produtos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM produtos ORDER BY id ASC')).rows.map(p => ({...p, preco: parseFloat(p.preco)}))); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/produtos', async (req, res) => { 
    try { 
        res.json({ sucesso: true, produto: (await pool.query(
            'INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url, venda_por_peso, tag, tipo_promocao, valor_promocao) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *', 
            [
                req.body.nome, 
                req.body.descricao, 
                req.body.preco, 
                req.body.emoji, 
                req.body.categoria || 'Outros', 
                req.body.grupos_ids || [], 
                req.body.imagem_url, 
                req.body.venda_por_peso || false, 
                req.body.tag || '',
                req.body.tipo_promocao || 'nenhuma', // 👈 NOVA GAVETA
                req.body.valor_promocao || 0         // 👈 NOVA GAVETA
            ]
        )).rows[0] }); 
    } catch (e) { res.status(500).json({erro:"Erro ao salvar produto"}); }
});

app.put('/api/produtos/:id', async (req, res) => { 
    try { 
        res.json({ sucesso: true, produto: (await pool.query(
            'UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6, imagem_url = $7, venda_por_peso = $8, tag = $9, tipo_promocao = $10, valor_promocao = $11 WHERE id = $12 RETURNING *', 
            [
                req.body.nome, 
                req.body.descricao, 
                req.body.preco, 
                req.body.emoji, 
                req.body.categoria || 'Outros', 
                req.body.grupos_ids || [], 
                req.body.imagem_url, 
                req.body.venda_por_peso || false, 
                req.body.tag || '',
                req.body.tipo_promocao || 'nenhuma', // 👈 NOVA GAVETA
                req.body.valor_promocao || 0,        // 👈 NOVA GAVETA
                req.params.id
            ]
        )).rows[0] }); 
    } catch (e) { res.status(500).json({erro:"Erro ao atualizar produto"}); }
});
app.delete('/api/produtos/:id', async (req, res) => { try { await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/produtos/:id/status', async (req, res) => { try { await pool.query('UPDATE produtos SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/grupos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM grupos_adicionais ORDER BY id DESC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/grupos', async (req, res) => { try { res.json({ sucesso: true, grupo: (await pool.query('INSERT INTO grupos_adicionais (nome, limite, itens, obrigatorio) VALUES ($1, $2, $3, $4) RETURNING *', [req.body.nome, req.body.limite, req.body.itens ? JSON.stringify(req.body.itens) : '[]', req.body.obrigatorio || false])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/grupos/:id', async (req, res) => { try { res.json({ sucesso: true, grupo: (await pool.query('UPDATE grupos_adicionais SET nome = $1, limite = $2, itens = $3, obrigatorio = $4 WHERE id = $5 RETURNING *', [req.body.nome, req.body.limite, req.body.itens ? JSON.stringify(req.body.itens) : '[]', req.body.obrigatorio || false, req.params.id])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/grupos/:id', async (req, res) => { try { await pool.query('DELETE FROM grupos_adicionais WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/grupos/:id/status', async (req, res) => { try { await pool.query('UPDATE grupos_adicionais SET ativo = $1 WHERE id = $2', [req.body.ativo, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/categorias', async (req, res) => { try { res.json((await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/categorias', async (req, res) => { 
    try { 
        const mostrar = req.body.mostrar_cardapio !== false; // Se vier vazio, é true
        res.json({ sucesso: true, categoria: (await pool.query('INSERT INTO categorias (nome, ordem, mostrar_cardapio) VALUES ($1, $2, $3) RETURNING *', [req.body.nome, req.body.ordem || 0, mostrar])).rows[0] }); 
    } catch (e) { 
        res.status(500).json({erro:"Erro"}); 
    }
});
app.delete('/api/categorias/:id', async (req, res) => { try { await pool.query('DELETE FROM categorias WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

// 🎚️ NOVA ROTA: Atualiza a visibilidade da categoria no Cardápio App
app.put('/api/categorias/:id', async (req, res) => { 
    try { 
        const mostrar = req.body.mostrar_cardapio !== false;
        await pool.query('UPDATE categorias SET mostrar_cardapio = $1 WHERE id = $2', [mostrar, req.params.id]); 
        res.json({ sucesso: true }); 
    } catch (e) { 
        res.status(500).json({erro:"Erro ao atualizar categoria"}); 
    }
});

// Rota para salvar a reordenação (Drag and Drop)
app.put('/api/categorias/ordem', async (req, res) => {
    try {
        const categorias = req.body; 
        for (let cat of categorias) {
            await pool.query('UPDATE categorias SET ordem = $1 WHERE id = $2', [cat.ordem, cat.id]);
        }
        res.json({ sucesso: true });
    } catch (e) { 
        res.status(500).json({erro: "Erro ao atualizar a ordem das categorias"}); 
    }
});

// ==========================================
// 🏙️ ROTAS DE CIDADES E BAIRROS
// ==========================================
app.get('/api/cidades', async (req, res) => { try { res.json((await pool.query('SELECT * FROM cidades ORDER BY nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/cidades', async (req, res) => { try { res.json((await pool.query('INSERT INTO cidades (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING RETURNING *', [req.body.nome])).rows[0]); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.delete('/api/cidades/:id', async (req, res) => { try { await pool.query('DELETE FROM cidades WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/bairros', async (req, res) => { try { res.json((await pool.query('SELECT * FROM bairros ORDER BY cidade ASC, nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/bairros', async (req, res) => { 
    try { 
        // Se a cidade vier vazia, usamos Quatis como proteção contra falhas
        const cidadeStr = req.body.cidade || 'Quatis';
        res.json((await pool.query('INSERT INTO bairros (nome, taxa, cidade) VALUES ($1, $2, $3) RETURNING *', [req.body.nome, req.body.taxa, cidadeStr])).rows[0]); 
    } catch (e) { 
        res.status(500).json({erro:"Erro ao salvar bairro"}); 
    }
});
app.delete('/api/bairros/:id', async (req, res) => { try { await pool.query('DELETE FROM bairros WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.get('/api/loja/status', async (req, res) => { try { res.json({ status: (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'status_delivery'")).rows[0]?.valor || 'aberto' }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/loja/status', async (req, res) => { try { await pool.query("UPDATE configuracoes SET valor = $1 WHERE chave = 'status_delivery'", [req.body.status]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.get('/api/configuracoes', async (req, res) => { try { const configs = {}; (await pool.query("SELECT * FROM configuracoes")).rows.forEach(r => configs[r.chave] = r.valor); res.json(configs); } catch (e) { res.status(500).json({erro:"Erro"}); }});

app.put('/api/configuracoes', async (req, res) => {
    try {
        // Pega todas as configurações que o painel enviou (ex: nome_loja, cor, banner)
        const chaves = Object.keys(req.body);
        
        for (let chave of chaves) {
            let valor = String(req.body[chave]); // Transforma tudo em texto para o banco aceitar
            
            // Tenta inserir a nova configuração. Se a gaveta (chave) já existir, ele só atualiza o valor!
            await pool.query(
                `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
                 ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
                [chave, valor]
            );
        }
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao salvar configurações:", e);
        res.status(500).json({ erro: "Erro ao salvar configuracoes" });
    }
});

// ==========================================
// MÓDULO CRM E FIDELIDADE (CÉREBRO)
// ==========================================
app.get('/api/crm/clientes', async (req, res) => {
    try {
        // A mágica do SQL: Agrupa as vendas pelo telefone do cliente (ignorando vendas canceladas ou sem telefone)
        const querySql = `
            SELECT 
                cliente_telefone AS telefone,
                MAX(cliente_nome) AS nome,
                COUNT(*) AS total_pedidos,
                SUM(valor_total) AS total_gasto,
                MAX(data_hora) AS ultima_compra
            FROM vendas
            WHERE cliente_telefone IS NOT NULL 
              AND TRIM(cliente_telefone) != '' 
              AND status != 'Cancelada'
            GROUP BY cliente_telefone
            ORDER BY ultima_compra DESC
        `;
        
        const resultado = await pool.query(querySql);
        res.json(resultado.rows);
    } catch (erro) {
        console.error("Erro ao gerar lista do CRM:", erro);
        res.status(500).json({ erro: "Erro ao carregar dados do CRM" });
    }
});

// ==========================================
// ⚙️ ROTAS DE CONFIGURAÇÕES (WHATSAPP E MENSAGENS)
// ==========================================

// 1. Cria a NOVA tabela separada só para integrações
pool.query(`
    CREATE TABLE IF NOT EXISTS integracoes_config (
        id SERIAL PRIMARY KEY,
        zap_url TEXT,
        zap_key TEXT,
        zap_instancia TEXT,
        msg_boas_vindas TEXT,
        msg_aceito TEXT,
        msg_entrega TEXT,
        msg_concluido TEXT
    );
`).then(async () => {
    const { rowCount } = await pool.query('SELECT * FROM integracoes_config');
    if (rowCount === 0) {
        await pool.query('INSERT INTO integracoes_config (zap_instancia) VALUES ($1)', ['IcesoftBot']);
    }
}).catch(console.error);

// 2. Rota para LER as configurações de integração
app.get('/api/integracoes', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
        res.json(rows[0] || {});
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar configurações" });
    }
});

// 3. Rota para SALVAR as configurações (VERSÃO RAIO-X)
app.put('/api/integracoes', async (req, res) => {
    console.log("📥 DADOS RECEBIDOS DO PAINEL PARA SALVAR:", req.body);
    
    try {
        const dados = req.body;
        if (!dados || Object.keys(dados).length === 0) {
            console.log("⚠️ ALERTA: O painel não enviou nenhum dado!");
            return res.json({ sucesso: true }); 
        }

        const check = await pool.query('SELECT * FROM integracoes_config');
        if (check.rowCount === 0) {
            await pool.query('INSERT INTO integracoes_config (zap_instancia) VALUES ($1)', ['IcesoftBot']);
        }

        const chaves = Object.keys(dados);
        let querySet = chaves.map((chave, index) => `${chave} = $${index + 1}`).join(', ');
        let valores = Object.values(dados);

        await pool.query(`UPDATE integracoes_config SET ${querySet}`, valores);
        
        console.log("✅ BANCO ATUALIZADO COM SUCESSO!");
        res.json({ sucesso: true });
    } catch (e) {
        console.error("❌ Erro ao salvar config:", e);
        res.status(500).json({ erro: "Erro ao salvar configurações" });
    }
});


// ==========================================
// 🤖 ROTAS DE INTEGRAÇÃO DO WHATSAPP
// ==========================================
app.get('/api/whatsapp/qrcode', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
        const config = rows[0];

        console.log("🔍 Tentando conectar Zap com:", config);

        if (!config || !config.zap_url || !config.zap_key || !config.zap_instancia) {
            return res.status(400).json({ erro: "WhatsApp não configurado. Salve os dados no painel primeiro!" });
        }

        // 1. Limpeza de dados (Tira a barra '/' do final da URL, se o usuário digitou por engano)
        const url = config.zap_url.trim().replace(/\/$/, ""); 
        const key = config.zap_key.trim();
        
        // 2. Proteção de URL: Codifica espaços e caracteres especiais no nome da instância
        const nomeInstanciaBruto = config.zap_instancia.trim();
        const instanciaURL = encodeURIComponent(nomeInstanciaBruto);

        const headers = {
            'apikey': key,
            'Content-Type': 'application/json'
        };

        // 3. Checa se a instância já existe
        const resStatus = await fetch(`${url}/instance/connectionState/${instanciaURL}`, { headers });
        
        if (resStatus.status === 404) {
            console.log("🛠️ Instância não existe. Criando nova...");
            
            // 4. Cria a instância e JÁ FORÇA a geração do QR Code
            const resCreate = await fetch(`${url}/instance/create`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    instanceName: nomeInstanciaBruto,
                    qrcode: true, 
                    integration: "WHATSAPP-BAILEYS",
                    // 🛡️ BLINDAGEM DE SERVIDOR (Evita travamentos no Easypanel)
                    reject_call: true,       // Ignora ligações de voz/vídeo no Zap
                    groupsIgnore: true,      // Ignora processamento de Grupos (Poupa MUITA RAM)
                    readMessages: false,     // Não marca mensagens como lidas automaticamente
                    readStatus: false,       // Não baixa Status/Stories dos contatos
                    syncFullHistory: false   // PROÍBE o download de histórico antigo (Alivia a CPU)
                })
            });
            
            const dataCreate = await resCreate.json();
            
            // A API Evolution pode devolver o base64 dentro do objeto 'qrcode' ou direto na raiz
            if (dataCreate.qrcode && dataCreate.qrcode.base64) {
                return res.json({ status: 'QRCODE', qrcode: dataCreate.qrcode.base64 });
            } else if (dataCreate.base64) {
                return res.json({ status: 'QRCODE', qrcode: dataCreate.base64 });
            }
        } else if (!resStatus.ok) {
            // Proteção extra: se a Evolution retornar 401 (Não Autorizado) ou 403 (Proibido)
            return res.status(400).json({ erro: "A Evolution API recusou a conexão. Verifique se a sua Global API Key está correta!" });
        } else {
            const dataStatus = await resStatus.json();
            // Garante compatibilidade com a Evolution API v1 e v2
            const estado = dataStatus.instance?.state || dataStatus.state;
            
            if (estado === 'open') {
                return res.json({ status: 'CONECTADO', mensagem: 'O WhatsApp já está conectado!' });
            }
        }

        // 5. Se a instância já existe mas não está conectada, tenta puxar o QR Code
        const resQr = await fetch(`${url}/instance/connect/${instanciaURL}`, { headers });
        const dataQr = await resQr.json();

        if (dataQr.base64) {
            return res.json({ status: 'QRCODE', qrcode: dataQr.base64 });
        } else if (dataQr.qrcode && dataQr.qrcode.base64) {
            return res.json({ status: 'QRCODE', qrcode: dataQr.qrcode.base64 });
        } else {
            // Se o servidor da Evolution demorar a cuspir a imagem
            return res.json({ status: 'AGUARDANDO', mensagem: 'A Evolution API está preparando o QR Code. Tente novamente em 5 segundos.' });
        }

    } catch (e) {
        console.error("❌ Erro fatal na API do Zap:", e);
        // Erro genérico de rede (caso a URL digitada não exista ou esteja fora do ar)
        res.status(500).json({ erro: "Falha de comunicação de rede. A URL da Evolution API está rodando no Easypanel?" });
    }
});

// ==========================================
// 💸 INTEGRAÇÃO MERCADO PAGO (PIX DINÂMICO)
// ==========================================

// 1. O GERADOR: Comunica com o Mercado Pago e devolve o Copia e Cola
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const { valor, cliente_nome, cliente_telefone } = req.body;

        // Busca a sua chave secreta do MP no nosso banco de dados
        const configQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
        const mpToken = configQuery.rows[0]?.valor;

        if (!mpToken) return res.status(400).json({ erro: "Mercado Pago não configurado no painel." });

        const idempotencyKey = "ICE-" + Date.now(); // Proteção contra cobrança duplicada

        // Faz o pedido do Pix direto pro servidor do Mercado Pago
        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${mpToken}`,
                'X-Idempotency-Key': idempotencyKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                transaction_amount: Number(valor),
                description: "Pedido Icesoft Delivery",
                payment_method_id: "pix",
                payer: {
                    email: "delivery@icesoft.com.br", // O MP exige e-mail, usamos um genérico se o cliente não der
                    first_name: cliente_nome || "Cliente"
                }
            })
        });

        const data = await mpResponse.json();

        if (data.error || !data.point_of_interaction) {
            console.error("Erro no Mercado Pago:", data);
            return res.status(500).json({ erro: "Falha ao gerar o Pix. Verifique a chave de acesso." });
        }

        // Devolve o QR Code e o Copia-Cola para o celular do cliente!
        res.json({
            sucesso: true,
            transacao_id: data.id,
            qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64,
            qr_code_copia_cola: data.point_of_interaction.transaction_data.qr_code
        });

    } catch (e) {
        console.error("Erro Pix:", e);
        res.status(500).json({ erro: "Erro interno ao gerar pagamento." });
    }
});

// 2. O VIGIA (WEBHOOK): Fica escutando o Mercado Pago avisar que o cliente pagou
app.post('/api/pagamento/webhook', async (req, res) => {
    // Retornamos 200 rápido pro Mercado Pago não ficar travado
    res.status(200).send("OK");

    try {
        const { type, data } = req.body;
        
        if (type === 'payment') {
            const pagamentoId = data.id;

            // Pega a chave para consultar a veracidade do pagamento
            const configQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
            const mpToken = configQuery.rows[0]?.valor;

            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
                headers: { 'Authorization': `Bearer ${mpToken}` }
            });
            const pgtoInfo = await mpResponse.json();

            if (pgtoInfo.status === 'approved') {
                // 🚀 PAGAMENTO CONFIRMADO!
                // Muda o status da venda e avisa a produção
                await pool.query("UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1", [pagamentoId.toString()]);
                console.log(`✅ Pagamento Pix ${pagamentoId} APROVADO e baixado no sistema!`);
            }
        }
    } catch (e) {
        console.error("Erro no Webhook do Mercado Pago:", e);
    }
});

// 3. ROTA ATIVA (Bypass de Webhook): O Cardápio pergunta ativamente se foi pago
app.get('/api/pagamento/pix/:id/status', async (req, res) => {
    try {
        const pagamentoId = req.params.id;
        
        // Pega a chave no cofre
        const configQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
        const mpToken = configQuery.rows[0]?.valor;

        // Bate na porta do Mercado Pago e pergunta o status do Pix
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
            headers: { 'Authorization': `Bearer ${mpToken}` }
        });
        const pgtoInfo = await mpResponse.json();

        // Se o MP confirmar que está aprovado, nós mesmos damos a baixa!
        if (pgtoInfo.status === 'approved') {
            await pool.query("UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1", [pagamentoId.toString()]);
            res.json({ pago: true });
        } else {
            res.json({ pago: false });
        }
    } catch (e) {
        res.status(500).json({ erro: "Erro ao consultar Mercado Pago" });
    }
});

// Iniciando Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft v5.0 ligado na porta ${PORTA}!`);
});
