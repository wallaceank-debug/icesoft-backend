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
const storage = multer.memoryStorage(); 
const upload = multer({ storage: storage });

// ==========================================
// ROTA MÁGICA DE UPLOAD E COMPRESSÃO
// ==========================================
app.post('/api/upload', upload.single('imagem'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ sucesso: false, erro: "Nenhuma imagem foi enviada." });

        const nomeArquivo = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webp';
        const caminhoFinal = path.join(pastaUploads, nomeArquivo);

        if (!fs.existsSync(pastaUploads)){ fs.mkdirSync(pastaUploads, { recursive: true }); }

        await sharp(req.file.buffer)
            .rotate() 
            .resize({ 
                width: 600, 
                height: 600, 
                fit: 'inside', 
                withoutEnlargement: true 
            }) 
            .webp({ quality: 80 }) 
            .toFile(caminhoFinal); 

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

            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY, 
                username VARCHAR(100) UNIQUE, 
                senha VARCHAR(100), 
                cargo VARCHAR(50) DEFAULT 'admin'
            );

            ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email VARCHAR(255);

            INSERT INTO usuarios (username, senha, email, cargo) 
            VALUES ('admin', 'icesoft123', 'admin@icesoft.com', 'admin') 
            ON CONFLICT (username) DO NOTHING;

            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS origem VARCHAR(50) DEFAULT 'Balcão';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imagem_url TEXT;
            ALTER TABLE grupos_adicionais ADD COLUMN IF NOT EXISTS obrigatorio BOOLEAN DEFAULT false;
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS observacoes TEXT;
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS venda_por_peso BOOLEAN DEFAULT false;
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tag VARCHAR(50);
            
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo_promocao VARCHAR(50) DEFAULT 'nenhuma';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS valor_promocao DECIMAL(10,2) DEFAULT 0;
            ALTER TABLE categorias ADD COLUMN IF NOT EXISTS mostrar_cardapio BOOLEAN DEFAULT true;
            
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS transacao_id VARCHAR(100);

            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS numero_diario INTEGER DEFAULT 0;
            ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_diaria DATE DEFAULT CURRENT_DATE;
            
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS promo_dias VARCHAR(50) DEFAULT '';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS promo_inicio VARCHAR(10) DEFAULT '';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS promo_fim VARCHAR(10) DEFAULT '';
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque INTEGER DEFAULT NULL;
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 0;
            ALTER TABLE produtos ADD COLUMN IF NOT EXISTS promo_pdv BOOLEAN DEFAULT false;

            CREATE TABLE IF NOT EXISTS funil_eventos (
                id SERIAL PRIMARY KEY,
                evento VARCHAR(50) NOT NULL,
                produto_nome VARCHAR(255),
                sessao_id VARCHAR(100),
                data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    })
    .then(() => console.log("📦 Estrutura do Banco 100% Blindada e Pronta!"))
    .catch(err => console.error('❌ Erro no banco:', err));


// ==========================================
// 📊 ROTA PARA PUXAR OS DADOS DO FUNIL
// ==========================================
app.get('/api/relatorios/funil', async (req, res) => {
    try {
        // 1. Contagem de Visitantes Únicos (Baseado na Sessão)
        const visitantes = await pool.query("SELECT COUNT(DISTINCT sessao_id) FROM funil_eventos WHERE evento = 'Visitou o Cardápio'");
        
        // 2. Contagem de Visualizações de Produtos
        const visualizacoes = await pool.query("SELECT COUNT(*) FROM funil_eventos WHERE evento = 'Visualizou Produto'");
        
        // 3. Contagem de Adições ao Carrinho
        const carrinho = await pool.query("SELECT COUNT(*) FROM funil_eventos WHERE evento = 'Adicionou ao Carrinho'");
        
        // 4. Contagem de Inícios de Checkout
        const checkout = await pool.query("SELECT COUNT(*) FROM funil_eventos WHERE evento = 'Iniciou Checkout'");
        
        // 5. Contagem de Vendas Reais (Pedidos que chegaram no seu sistema e não foram cancelados)
        const vendas = await pool.query("SELECT COUNT(*) FROM vendas WHERE status != 'Cancelada' AND status != 'Cancelado'");

        res.json({
            visitantes: parseInt(visitantes.rows[0].count),
            visualizacoes: parseInt(visualizacoes.rows[0].count),
            carrinho: parseInt(carrinho.rows[0].count),
            checkout: parseInt(checkout.rows[0].count),
            vendas: parseInt(vendas.rows[0].count)
        });
    } catch (e) {
        console.error("Erro ao gerar relatório do funil:", e);
        res.status(500).json({ erro: "Erro ao calcular funil" });
    }
});

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
        
        const queryDiario = await pool.query("SELECT COALESCE(MAX(numero_diario), 0) + 1 AS proximo FROM vendas WHERE data_diaria = CURRENT_DATE");
        const numeroDiario = queryDiario.rows[0].proximo;

        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id, numero_diario, data_diaria) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE)`, 
            [produto_nome, valorFinal, forma_pagamento, JSON.stringify(itens || []), status || 'Concluída', cliente_nome, cliente_telefone, cliente_endereco, origemFinal, observacoes || '', transacao_id || null, numeroDiario]
        ); 

       // === INÍCIO DO SISTEMA DE BAIXA DE ESTOQUE ===
        try {
          let itensComprados = typeof itens === 'string' ? JSON.parse(itens) : (itens || []);
          
          // 1. Puxa o catálogo e ordena do maior para o menor
          const queryEstoque = await pool.query("SELECT id, nome, estoque, ativo FROM produtos");
          let produtosNoBanco = queryEstoque.rows.sort((a, b) => b.nome.length - a.nome.length);

          for (let item of itensComprados) {
            let qtd = item.quantidade ? Number(item.quantidade) : 1;
            let nomeRaw = item.nome || item.produto_nome || item.nomeBase || "";
            
            if (typeof nomeRaw === 'string' && nomeRaw.trim() !== "") {
              
              // 2. Limpa SOMENTE acentos, emojis e põe minúsculo (Não vamos mais cortar palavras!)
              let nomeBusca = nomeRaw.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
                                       .toLowerCase()
                                       .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                                       .trim();

              // 3. A Mágica: Verifica se o nome do banco de dados ESTÁ DENTRO do texto sujo do carrinho
              let p = produtosNoBanco.find(prod => {
                  let nomeBD = prod.nome.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
                                        .toLowerCase()
                                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                                        .trim();
                  // Aqui está o segredo: inclui?
                  return nomeBusca.includes(nomeBD);
              });

              // ✅ SE ACHOU O PRODUTO E ELE TEM CONTROLE DE ESTOQUE
              if (p) {
                  if (p.estoque !== null && p.estoque > 0) {
                      let novoEstoque = Number(p.estoque) - qtd;
                      let continuaAtivo = p.ativo;
                      
                      if (novoEstoque <= 0) {
                        novoEstoque = 0;
                        continuaAtivo = false; 
                      }
                      
                      await pool.query("UPDATE produtos SET estoque = $1, ativo = $2 WHERE id = $3", [novoEstoque, continuaAtivo, p.id]);
                      p.estoque = novoEstoque; 
                      
                      console.log(`📉 Estoque de '${p.nome}' baixado com sucesso. Restam: ${novoEstoque}`);
                  }
              } else {
                  console.log(`⚠️ Aviso: Produto não encontrado para baixa: '${nomeRaw}' (Texto limpo procurado: '${nomeBusca}')`);
              }
            }
          }
        } catch (erroEstoque) {
          console.error("❌ Erro fatal ao tentar dar baixa no estoque:", erroEstoque);
        }
        // === FIM DO SISTEMA DE BAIXA DE ESTOQUE ===
// Resposta de sucesso para liberar a tela do PDV (Isso havia sido apagado!)
        res.status(201).json({ sucesso: true });

    } catch (erroGeral) {
        console.error("Erro ao registrar a venda:", erroGeral);
        res.status(500).json({ erro: "Erro interno ao salvar a venda no banco de dados." });
    }
});
        
// ==========================================
// ROTA DE MUDANÇA DE STATUS + DISPARO DE WHATSAPP
// ==========================================
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

                if (novoStatus === 'A Preparar' && config.msg_aceito) {
                    textoMensagem = config.msg_aceito;
                } else if (novoStatus === 'Saiu p/ Entrega' && config.msg_entrega) {
                    textoMensagem = config.msg_entrega;
                } else if (novoStatus === 'Entregue' && config.msg_concluido) {
                    textoMensagem = config.msg_concluido;
                }

                if (textoMensagem) {
                    const primeiroNome = venda.cliente_nome ? venda.cliente_nome.split(' ')[0] : 'Cliente';
                    
                    let textoPronto = textoMensagem
                        .replace(/{nome}/g, primeiroNome)
                        .replace(/{pedido}/g, venda.numero_diario || venda.id);

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

                    const telefoneLimpo = "55" + venda.cliente_telefone.replace(/\D/g, '');

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
        const resultado = await pool.query(
            'SELECT * FROM usuarios WHERE (username = $1 OR email = $1) AND senha = $2', 
            [username, senha]
        );
        
        if (resultado.rows.length > 0) {
            res.json({ 
                sucesso: true, 
                mensagem: "Login aprovado", 
                token: "cracha-icesoft-aprovado-" + Date.now(), 
                cargo: resultado.rows[0].cargo,
                usuario_id: resultado.rows[0].id 
            });
        } else {
            res.status(401).json({ sucesso: false, erro: "Usuário ou senha incorretos!" });
        }
    } catch (erro) { 
        console.error(erro);
        res.status(500).json({ erro: "Erro interno do servidor" }); 
    }
});

app.put('/api/usuarios/:id', async (req, res) => {
    const userId = req.params.id;
    const { novo_username, novo_email, nova_senha } = req.body;

    try {
        const userAtual = await pool.query('SELECT * FROM usuarios WHERE id = $1', [userId]);
        if (userAtual.rows.length === 0) return res.status(404).json({ erro: "Usuário não encontrado" });

        const user = userAtual.rows[0];
        
        const usernameFinal = novo_username || user.username;
        const emailFinal = novo_email || user.email;
        const senhaFinal = nova_senha || user.senha; 

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
        
        // 🐛 CORREÇÃO AQUI: Troca de "= 'dinheiro'" para "ILIKE '%dinheiro%'" e ignora vendas Canceladas!
        const queryVendas = `
            SELECT COALESCE(SUM(valor_total), 0) as total_vendas 
            FROM vendas 
            WHERE forma_pagamento ILIKE '%dinheiro%' 
              AND status NOT ILIKE '%cancelad%'
              AND data_hora >= $1
        `;
        const vendasDinheiro = parseFloat((await pool.query(queryVendas, [caixa.data_abertura])).rows[0].total_vendas) || 0;
        
        const movs = (await pool.query(`SELECT tipo, COALESCE(SUM(valor), 0) as total FROM movimentacoes_caixa WHERE caixa_id = $1 GROUP BY tipo`, [req.params.id])).rows;
        
        let suprimentos = 0, sangrias = 0;
        movs.forEach(r => { 
            if (r.tipo === 'Suprimento') suprimentos = parseFloat(r.total); 
            if (r.tipo === 'Sangria') sangrias = parseFloat(r.total); 
        });
        
        res.json({ 
            fundo: parseFloat(caixa.valor_inicial) || 0, 
            vendas_dinheiro: vendasDinheiro, 
            suprimentos, 
            sangrias, 
            esperado: (parseFloat(caixa.valor_inicial) || 0) + vendasDinheiro + suprimentos - sangrias 
        });
    } catch (e) { 
        res.status(500).json({ erro: "Erro Técnico" }); 
    }
});

// ==========================================
// ROTA NOVA: HISTÓRICO DE CAIXAS (MÊS)
// ==========================================
app.get('/api/caixa/historico', async (req, res) => {
  try {
    const { mes } = req.query; // Recebe no formato "YYYY-MM"
    
    // 1. Puxa todos os caixas que foram fechados no mês escolhido
    const querySql = `
      SELECT * FROM controle_caixa 
      WHERE status = 'Fechado' 
      AND TO_CHAR(data_fechamento, 'YYYY-MM') = $1
      ORDER BY data_fechamento DESC
    `;
    const caixas = (await pool.query(querySql, [mes])).rows;
    
    let historico = [];
    
    // 2. Calcula os totais de vendas e despesas exatos para cada caixa
    for (let c of caixas) {
        // Soma Dinheiro
        const vendasDinheiro = parseFloat((await pool.query(
            `SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE forma_pagamento ILIKE '%dinheiro%' AND data_hora >= $1 AND data_hora <= $2`, 
            [c.data_abertura, c.data_fechamento]
        )).rows[0].total) || 0;
        
        // Soma Cartão
        const vendasCartao = parseFloat((await pool.query(
            `SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE (forma_pagamento ILIKE '%cartão%' OR forma_pagamento ILIKE '%cartao%') AND data_hora >= $1 AND data_hora <= $2`, 
            [c.data_abertura, c.data_fechamento]
        )).rows[0].total) || 0;

        // Soma PIX
        const vendasPix = parseFloat((await pool.query(
            `SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE forma_pagamento ILIKE '%pix%' AND data_hora >= $1 AND data_hora <= $2`, 
            [c.data_abertura, c.data_fechamento]
        )).rows[0].total) || 0;
        
        // Soma Despesas
        const despesas = parseFloat((await pool.query(
            `SELECT COALESCE(SUM(valor), 0) as total FROM movimentacoes_caixa WHERE caixa_id = $1 AND LOWER(TRIM(tipo)) = 'sangria'`, 
            [c.id]
        )).rows[0].total) || 0;
        
        const formataData = (d) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro';

        historico.push({
            id: c.id,
            dataAbertura: formataData(c.data_abertura),
            dataFechamento: formataData(c.data_fechamento),
            totalCartao: vendasCartao,
            totalDinheiro: vendasDinheiro,
            totalPix: vendasPix,
            totalDespesas: despesas
        });
    }
    
    // AS LINHAS ABAIXO PROVAVELMENTE TINHAM SIDO APAGADAS!
    res.json(historico);
  } catch (e) {
    console.error("Erro ao gerar histórico de caixas:", e);
    res.status(500).json({ erro: "Erro Técnico ao buscar histórico" });
  }
}); // <--- Faltava fechar isso aqui!

// ==========================================
// ROTA NOVA: DETALHES DO CAIXA (VENDAS E SANGRIAS)
// ==========================================
app.get('/api/caixa/:id/detalhes', async (req, res) => {
  try {
    const caixaId = req.params.id;
    // 1. Busca as informações básicas do caixa
    const caixa = (await pool.query('SELECT * FROM controle_caixa WHERE id = $1', [caixaId])).rows[0];

    if (!caixa) {
      return res.status(404).json({ erro: "Caixa não encontrado" });
    }

    // 2. Busca as despesas (Sangrias e Suprimentos) deste caixa
    const movimentacoes = (await pool.query('SELECT * FROM movimentacoes_caixa WHERE caixa_id = $1 ORDER BY id DESC', [caixaId])).rows;

    // 3. Busca todas as vendas que ocorreram entre a abertura e o fechamento
    let vendas = [];
    if (caixa.data_abertura && caixa.data_fechamento) {
      vendas = (await pool.query(
        'SELECT * FROM vendas WHERE data_hora >= $1 AND data_hora <= $2 ORDER BY data_hora DESC',
        [caixa.data_abertura, caixa.data_fechamento]
      )).rows;
    }

    // Empacota tudo e envia para a tela!
    res.json({ caixa, movimentacoes, vendas });
  } catch (e) {
    console.error("Erro ao buscar detalhes do caixa:", e);
    res.status(500).json({ erro: "Erro Técnico" });
  }
});

// ==========================================
// ROTAS DE MESAS E COMANDAS
// ==========================================
app.get('/api/mesas', async (req, res) => { try { res.json((await pool.query('SELECT * FROM mesas_ativas ORDER BY numero ASC')).rows); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/mesas', async (req, res) => { try { res.status(201).json((await pool.query("INSERT INTO mesas_ativas (numero, itens) VALUES ($1, $2) RETURNING *", [req.body.numero, JSON.stringify(req.body.itens || [])])).rows[0]); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.put('/api/mesas/:id', async (req, res) => { try { res.json((await pool.query("UPDATE mesas_ativas SET itens = $1 WHERE id = $2 RETURNING *", [JSON.stringify(req.body.itens), req.params.id])).rows[0]); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.delete('/api/mesas/:id', async (req, res) => { try { await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

// ==========================================
// ROTA DO ESTOQUE RÁPIDO
// ==========================================
app.put('/api/produtos/:id/estoque', async (req, res) => {
  try {
    const { estoque } = req.body;
    await pool.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [estoque, req.params.id]);
    res.json({ sucesso: true });
  } catch (e) {
    console.error("Erro ao mudar estoque", e);
    res.status(500).json({erro: "Erro ao alterar estoque."});
  }
});

// ==========================================
// DEMAIS ROTAS (Produtos, Configs, Bairros, etc)
// ==========================================
app.get('/api/status', (req, res) => res.json({ mensagem: "✅ Motor v5.0 pronto para Relatórios!" }));
app.get('/api/produtos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM produtos ORDER BY ordem ASC, id ASC')).rows.map(p => ({...p, preco: parseFloat(p.preco)}))); } catch (e) { res.status(500).json({erro:"Erro"}); }});

// ==========================================
// ROTA PARA SALVAR A ORDEM DOS PRODUTOS
// ==========================================
app.put('/api/produtos/ordem', async (req, res) => {
    try {
        const produtos = req.body; 
        for (let p of produtos) {
            await pool.query('UPDATE produtos SET ordem = $1 WHERE id = $2', [p.ordem, p.id]);
        }
        res.json({ sucesso: true });
    } catch (e) { 
        res.status(500).json({erro: "Erro ao atualizar a ordem dos produtos"}); 
    }
});

app.post('/api/produtos', async (req, res) => { 
    try { 
        res.json({ sucesso: true, produto: (await pool.query(
            // 🐛 CORREÇÃO 1: Adicionado "promo_pdv" na lista e o "$15" no VALUES
            'INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url, venda_por_peso, tag, tipo_promocao, valor_promocao, promo_dias, promo_inicio, promo_fim, promo_pdv) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *', 
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
                req.body.tipo_promocao || 'nenhuma', 
                req.body.valor_promocao || 0,
                req.body.promo_dias || '',     
                req.body.promo_inicio || '',   
                req.body.promo_fim || '',       // 🐛 CORREÇÃO 2: Vírgula adicionada aqui
                req.body.promo_pdv || false
            ]
        )).rows[0] }); 
    } catch (e) { res.status(500).json({erro:"Erro ao salvar produto"}); }
});

app.put('/api/produtos/:id', async (req, res) => { 
    try { 
        res.json({ sucesso: true, produto: (await pool.query(
            // 🐛 CORREÇÃO 3: Adicionado "promo_pdv = $15" e o ID virou "$16"
            'UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6, imagem_url = $7, venda_por_peso = $8, tag = $9, tipo_promocao = $10, valor_promocao = $11, promo_dias = $12, promo_inicio = $13, promo_fim = $14, promo_pdv = $15 WHERE id = $16 RETURNING *', 
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
                req.body.tipo_promocao || 'nenhuma', 
                req.body.valor_promocao || 0,
                req.body.promo_dias || '',     
                req.body.promo_inicio || '',   
                req.body.promo_fim || '',      
                req.body.promo_pdv || false,    // 🐛 CORREÇÃO 4: Vírgula adicionada aqui
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

// ==========================================
// ROTAS DE CATEGORIAS (Corrigidas)
// ==========================================
app.get('/api/categorias', async (req, res) => { try { res.json((await pool.query('SELECT * FROM categorias ORDER BY ordem ASC, id ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/categorias', async (req, res) => { 
    try { 
        const mostrar = req.body.mostrar_cardapio !== false; 
        res.json({ sucesso: true, categoria: (await pool.query('INSERT INTO categorias (nome, ordem, mostrar_cardapio) VALUES ($1, $2, $3) RETURNING *', [req.body.nome, req.body.ordem || 0, mostrar])).rows[0] }); 
    } catch (e) { 
        res.status(500).json({erro:"Erro"}); 
    }
});
app.delete('/api/categorias/:id', async (req, res) => { try { await pool.query('DELETE FROM categorias WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

// ⚠️ ROTA DE ORDEM PRECISA FICAR ANTES DO :ID
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

// ⚠️ ROTA DE :ID VEM DEPOIS (Atualizar visibilidade)
app.put('/api/categorias/:id', async (req, res) => { 
    try { 
        const mostrar = req.body.mostrar_cardapio !== false;
        await pool.query('UPDATE categorias SET mostrar_cardapio = $1 WHERE id = $2', [mostrar, req.params.id]); 
        res.json({ sucesso: true }); 
    } catch (e) { 
        res.status(500).json({erro:"Erro ao atualizar categoria"}); 
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
        const chaves = Object.keys(req.body);
        
        for (let chave of chaves) {
            let valor = String(req.body[chave]); 
            
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
              AND status != 'Cancelada' AND status != 'Cancelado'
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

app.get('/api/integracoes', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
        res.json(rows[0] || {});
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar configurações" });
    }
});

app.put('/api/integracoes', async (req, res) => {
    try {
        const dados = req.body;
        if (!dados || Object.keys(dados).length === 0) {
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
        res.json({ sucesso: true });
    } catch (e) {
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

        if (!config || !config.zap_url || !config.zap_key || !config.zap_instancia) {
            return res.status(400).json({ erro: "WhatsApp não configurado. Salve os dados no painel primeiro!" });
        }

        const url = config.zap_url.trim().replace(/\/$/, ""); 
        const key = config.zap_key.trim();
        const nomeInstanciaBruto = config.zap_instancia.trim();
        const instanciaURL = encodeURIComponent(nomeInstanciaBruto);

        const headers = {
            'apikey': key,
            'Content-Type': 'application/json'
        };

        const resStatus = await fetch(`${url}/instance/connectionState/${instanciaURL}`, { headers });
        
        if (resStatus.status === 404) {
            const resCreate = await fetch(`${url}/instance/create`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    instanceName: nomeInstanciaBruto,
                    qrcode: true, 
                    integration: "WHATSAPP-BAILEYS",
                    reject_call: true,       
                    groupsIgnore: true,      
                    readMessages: false,     
                    readStatus: false,       
                    syncFullHistory: false   
                })
            });
            
            const dataCreate = await resCreate.json();
            
            if (dataCreate.qrcode && dataCreate.qrcode.base64) {
                return res.json({ status: 'QRCODE', qrcode: dataCreate.qrcode.base64 });
            } else if (dataCreate.base64) {
                return res.json({ status: 'QRCODE', qrcode: dataCreate.base64 });
            }
        } else if (!resStatus.ok) {
            return res.status(400).json({ erro: "A Evolution API recusou a conexão. Verifique se a sua Global API Key está correta!" });
        } else {
            const dataStatus = await resStatus.json();
            const estado = dataStatus.instance?.state || dataStatus.state;
            
            if (estado === 'open') {
                return res.json({ status: 'CONECTADO', mensagem: 'O WhatsApp já está conectado!' });
            }
        }

        const resQr = await fetch(`${url}/instance/connect/${instanciaURL}`, { headers });
        const dataQr = await resQr.json();

        if (dataQr.base64) {
            return res.json({ status: 'QRCODE', qrcode: dataQr.base64 });
        } else if (dataQr.qrcode && dataQr.qrcode.base64) {
            return res.json({ status: 'QRCODE', qrcode: dataQr.qrcode.base64 });
        } else {
            return res.json({ status: 'AGUARDANDO', mensagem: 'A Evolution API está preparando o QR Code. Tente novamente em 5 segundos.' });
        }

    } catch (e) {
        console.error("❌ Erro fatal na API do Zap:", e);
        res.status(500).json({ erro: "Falha de comunicação de rede. A URL da Evolution API está rodando no Easypanel?" });
    }
});

// ==========================================
// 💸 INTEGRAÇÃO MERCADO PAGO (PIX DINÂMICO)
// ==========================================
app.post('/api/pagamento/pix', async (req, res) => {
    try {
        const { valor, cliente_nome, cliente_telefone } = req.body;

        const configQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
        const mpToken = configQuery.rows[0]?.valor;

        if (!mpToken) return res.status(400).json({ erro: "Mercado Pago não configurado no painel." });

        const idempotencyKey = "ICE-" + Date.now(); 

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
                    email: "delivery@icesoft.com.br", 
                    first_name: cliente_nome || "Cliente"
                }
            })
        });

        const data = await mpResponse.json();

        if (data.error || !data.point_of_interaction) {
            console.error("Erro no Mercado Pago:", data);
            return res.status(500).json({ erro: "Falha ao gerar o Pix. Verifique a chave de acesso." });
        }

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

app.post('/api/pagamento/webhook', async (req, res) => {
    res.status(200).send("OK");

    try {
        const { type, data } = req.body;
        
        if (type === 'payment') {
            const pagamentoId = data.id;

            const configQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
            const mpToken = configQuery.rows[0]?.valor;

            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
                headers: { 'Authorization': `Bearer ${mpToken}` }
            });
            const pgtoInfo = await mpResponse.json();

            if (pgtoInfo.status === 'approved') {
                await pool.query("UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1", [pagamentoId.toString()]);
                console.log(`✅ Pagamento Pix ${pagamentoId} APROVADO e baixado no sistema!`);
            }
        }
    } catch (e) {
        console.error("Erro no Webhook do Mercado Pago:", e);
    }
});

app.get('/api/pagamento/pix/:id/status', async (req, res) => {
    try {
        const pagamentoId = req.params.id;
        
        const configQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'");
        const mpToken = configQuery.rows[0]?.valor;

        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, {
            headers: { 'Authorization': `Bearer ${mpToken}` }
        });
        const pgtoInfo = await mpResponse.json();

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

// ==========================================
// ROTA DO ESTOQUE RÁPIDO (CORREÇÃO 404)
// ==========================================
app.put('/api/produtos/:id/estoque', async (req, res) => {
  try {
    const { estoque } = req.body;
    await pool.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [estoque, req.params.id]);
    res.json({ sucesso: true });
  } catch (e) {
    console.error("Erro ao mudar estoque", e);
    res.status(500).json({erro: "Erro ao alterar estoque."});
  }
});

// ==========================================
// 🚀 ROTA DO FUNIL DE VENDAS (RAIO-X DO CLIENTE)
// ==========================================
app.post('/api/funil', async (req, res) => {
    try {
        const { evento, produto_nome, sessao_id } = req.body;
        
        // Se não vier evento, nem tenta salvar
        if (!evento) return res.status(400).json({ erro: "Evento não informado" });

        await pool.query(
            "INSERT INTO funil_eventos (evento, produto_nome, sessao_id) VALUES ($1, $2, $3)",
            [evento, produto_nome || null, sessao_id || null]
        );

        res.status(201).json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao registrar evento no funil:", e);
        res.status(500).json({ erro: "Erro interno no funil" });
    }
});


// Iniciando Servidor
const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
    console.log(`🚀 Servidor da Icesoft v5.0 ligado na porta ${PORTA}!`);
});
