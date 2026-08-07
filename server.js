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

// --- INÍCIO DA BLINDAGEM DE SEGURANÇA ---
const jwt = require('jsonwebtoken'); 
const SEGREDO_JWT = process.env.JWT_SECRET || 'chave_mestra_icesoft_segura';

function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ erro: "Acesso negado. Onde está o seu crachá?" });
    
    try {
        const tokenLimpo = token.split(' ')[1] || token;
        const decodificado = jwt.verify(tokenLimpo, SEGREDO_JWT);
        req.usuario = decodificado;
        next(); 
    } catch (e) {
        res.status(401).json({ erro: "Crachá falso ou vencido!" });
    }
}
// --- FIM DA BLINDAGEM DE SEGURANÇA ---

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
let clientesNoCardapio = 0; // 📡 Memória do Radar

io.on('connection', (socket) => {
    console.log(`🔌 Novo dispositivo conectado: ${socket.id}`);

    // Quando um cliente abre o Cardápio Digital
    socket.on('entrou_no_cardapio', () => {
        socket.isClienteCardapio = true; // Coloca um "crachá" invisível neste celular
        clientesNoCardapio++;
        io.emit('atualiza_clientes_online', clientesNoCardapio); // Grita no rádio para o PDV ouvir
    });

    // Quando o cliente fecha a aba ou o navegador
    socket.on('disconnect', () => {
         console.log(`❌ Dispositivo desconectado: ${socket.id}`);
         if (socket.isClienteCardapio) {
             clientesNoCardapio--;
             if (clientesNoCardapio < 0) clientesNoCardapio = 0;
             io.emit('atualiza_clientes_online', clientesNoCardapio); // Atualiza o PDV
         }
    });
});

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🩺 ROTA DE SAÚDE (HEALTH CHECK) PARA O EASYPANEL NÃO MATAR O SERVIDOR
app.get('/', (req, res) => {
    res.status(200).send('API da Icesoft operando 100% e Saudável!');
});

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
            
            -- Tabela Atualizada com novos campos de agendamento:
            CREATE TABLE IF NOT EXISTS categorias (
                id SERIAL PRIMARY KEY, nome TEXT, ordem INTEGER, mostrar_cardapio BOOLEAN DEFAULT true,
                dias_semana VARCHAR(50) DEFAULT '', hora_inicio VARCHAR(10) DEFAULT '', hora_fim VARCHAR(10) DEFAULT ''
            );
            
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

            CREATE TABLE IF NOT EXISTS marketing_envios (
                id SERIAL PRIMARY KEY, 
                telefone VARCHAR(20), 
                cliente_nome VARCHAR(100),
                campanha TEXT, 
                data_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    })
    .then(async () => {
        // 🛡️ Segurança: Atualiza as tabelas antigas para garantir que os campos existam
        await pool.query("ALTER TABLE mesas_ativas ALTER COLUMN numero TYPE TEXT"); // 👇 NOVO: Remove o limite de 10 letras para suportar nomes compridos de clientes nas comandas
        await pool.query("ALTER TABLE categorias ADD COLUMN IF NOT EXISTS dias_semana VARCHAR(50) DEFAULT ''");
        await pool.query("ALTER TABLE categorias ADD COLUMN IF NOT EXISTS hora_inicio VARCHAR(10) DEFAULT ''");
        await pool.query("ALTER TABLE categorias ADD COLUMN IF NOT EXISTS hora_fim VARCHAR(10) DEFAULT ''");
        await pool.query("ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categorias_adicionais JSONB DEFAULT '[]'");
        
        // 📦 NOVAS COLUNAS DO ESTOQUE INTELIGENTE
        await pool.query("ALTER TABLE produtos ADD COLUMN IF NOT EXISTS controlar_estoque BOOLEAN DEFAULT false");
        await pool.query("ALTER TABLE produtos ADD COLUMN IF NOT EXISTS mostrar_estoque BOOLEAN DEFAULT false");
        // 👇 NOVO: Adiciona a coluna de custo para o cálculo do CMV Real
        await pool.query("ALTER TABLE produtos ADD COLUMN IF NOT EXISTS custo DECIMAL(10,2) DEFAULT 0.00");
        
        // 📦 NOVO: Cria a tabela de Insumos e a coluna da Ficha Técnica nos Produtos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS insumos (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                unidade VARCHAR(20) NOT NULL,
                custo DECIMAL(10,4) DEFAULT 0
            );
        `);
        await pool.query("ALTER TABLE produtos ADD COLUMN IF NOT EXISTS insumos_json JSONB DEFAULT '[]'");
        
        // 👇 NOVO: Cria a coluna de inativação no banco de dados
        await pool.query("ALTER TABLE fin_categorias ADD COLUMN IF NOT EXISTS ativa BOOLEAN DEFAULT true");
        // 🚚 NOVAS COLUNAS PARA FRETE E CUPOM SEPARADOS
        await pool.query("ALTER TABLE vendas ADD COLUMN IF NOT EXISTS taxa_entrega DECIMAL(10,2) DEFAULT 0.00");
        await pool.query("ALTER TABLE vendas ADD COLUMN IF NOT EXISTS desconto DECIMAL(10,2) DEFAULT 0.00");
        await pool.query("ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cupom_usado VARCHAR(50) DEFAULT NULL");
        // 👇 NOVO: Colunas para armazenar o lucro real e baixar o estoque de matérias-primas
        await pool.query("ALTER TABLE vendas ADD COLUMN IF NOT EXISTS custo_real DECIMAL(10,2) DEFAULT 0.00");
        await pool.query("ALTER TABLE insumos ADD COLUMN IF NOT EXISTS estoque DECIMAL(10,4) DEFAULT 0");
        // 👇 NOVA: Aumenta o tamanho da coluna forma_pagamento para caber o texto do Pagamento Dividido
        await pool.query("ALTER TABLE vendas ALTER COLUMN forma_pagamento TYPE TEXT");

        // 🛠️ AUTO-CURA AMPLIADA: Sincroniza os contadores de IDs para todas as tabelas de alto fluxo
        try {
            const tabelasCriticas = ['fin_lancamentos', 'vendas', 'controle_caixa', 'movimentacoes_caixa', 'funil_eventos', 'fin_categorias', 'fin_contas_bancarias'];
            for (let tabela of tabelasCriticas) {
                await pool.query(`SELECT setval(pg_get_serial_sequence('${tabela}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${tabela};`).catch(()=>null);
            }
        } catch (e) { console.log("Aviso: Sincronização de sequências pulada."); }

        console.log("📦 Estrutura do Banco 100% Blindada e Pronta!");
    })
    .catch(err => console.error('❌ Erro no banco:', err));


app.get('/api/relatorios/funil', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let filtroSQL = ''; let params = [];
        if (inicio && fim) { 
            // 🛡️ VACINA ANTI-FUSO (FUNIL)
            filtroSQL = " AND (data_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1 AND $2"; 
            params = [inicio, fim]; 
        }
        
        // 👇 A MÁGICA: Agora todas as etapas contam SESSÕES ÚNICAS (Pessoas) em vez de Cliques!
        const visitantes = await pool.query(`SELECT COUNT(DISTINCT sessao_id) FROM funil_eventos WHERE evento = 'Visitou o Cardápio'${filtroSQL}`, params);
        const visualizacoes = await pool.query(`SELECT COUNT(DISTINCT sessao_id) FROM funil_eventos WHERE evento = 'Visualizou Produto'${filtroSQL}`, params);
        const carrinho = await pool.query(`SELECT COUNT(DISTINCT sessao_id) FROM funil_eventos WHERE evento = 'Adicionou ao Carrinho'${filtroSQL}`, params);
        const checkout = await pool.query(`SELECT COUNT(DISTINCT sessao_id) FROM funil_eventos WHERE evento = 'Iniciou Checkout'${filtroSQL}`, params);
        
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
            // 🛡️ VACINA ANTI-FUSO (RAIO-X)
            filtroSQL = " AND (data_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1 AND $2"; 
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

app.get('/api/vendas', verificarToken, async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let querySql = 'SELECT * FROM vendas'; let params = [];
        if (inicio && fim) { 
            // 🛡️ VACINA ANTI-FUSO: Converte UTC para Brasília antes de filtrar a data
            querySql += " WHERE (data_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1 AND $2"; 
            params = [inicio, fim]; 
        }
        querySql += ' ORDER BY data_hora DESC';
        res.json((await pool.query(querySql, params)).rows);
    } catch (e) { res.status(500).json({ erro: "Erro ao buscar vendas" }); }
});

// ==========================================
// 🎟️ NOVO: VALIDAÇÃO DE CUPOM BLINDADA (POR CELULAR)
// ==========================================
app.post('/api/cupons/validar', async (req, res) => {
    try {
        const { codigo, telefone, subtotal } = req.body;
        if (!codigo || !telefone) return res.status(400).json({ erro: "Código e celular são obrigatórios." });

        const config = (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'cupons_delivery'")).rows[0];
        if (!config) return res.status(400).json({ erro: "Nenhum cupom ativo no momento." });

        let cupons = [];
        try { cupons = JSON.parse(config.valor); } catch(e) {}

        const cupom = cupons.find(c => c.codigo.toUpperCase() === codigo.toUpperCase());
        if (!cupom) return res.status(400).json({ erro: "Cupom inválido ou inexistente." });

        // 1. Regra de Valor Mínimo
        if (cupom.minimo > 0 && subtotal < cupom.minimo) {
            return res.status(400).json({ erro: `Este cupom exige pedidos acima de R$ ${cupom.minimo.toFixed(2).replace('.',',')}` });
        }

        // 2. Regra de Validade
        if (cupom.validade) {
            const dataSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
            if (dataSP > cupom.validade) return res.status(400).json({ erro: "Este cupom já expirou!" });
        }

        // 3. Regra de Limite Total do Sistema
        if (cupom.limite > 0 && cupom.usos_atuais >= cupom.limite) {
            return res.status(400).json({ erro: "Este cupom atingiu o limite máximo de usos!" });
        }

        // 4. MÁGICA: A Regra de Público (Exatamente a que você escolhe na tela!)
        const countQuery = await pool.query("SELECT COUNT(*) as total FROM vendas WHERE cliente_telefone = $1 AND status NOT ILIKE '%cancelad%'", [telefone]);
        const totalPedidos = parseInt(countQuery.rows[0].total) || 0;

        // Se for BEMVINDO15 (Só Clientes Novos)
        if (cupom.publico === 'novos' && totalPedidos > 0) {
            return res.status(400).json({ erro: "Exclusivo para a primeira compra!" });
        }
        
        // Se for Só Recorrentes
        if (cupom.publico === 'recorrentes' && totalPedidos === 0) {
            return res.status(400).json({ erro: "Exclusivo para clientes recorrentes!" });
        }

        // Se você escolheu a nova opção "Uso Único", a trava de celular entra em ação
        if (cupom.publico === 'unico') {
            const usoAnterior = await pool.query("SELECT id FROM vendas WHERE cliente_telefone = $1 AND UPPER(cupom_usado) = $2 AND status NOT ILIKE '%cancelad%'", [telefone, codigo.toUpperCase()]);
            if (usoAnterior.rows.length > 0) {
                return res.status(400).json({ erro: "Você já utilizou este cupom!" });
            }
        }
        
        // Se for 'todos', ele passa direto sem nenhuma trava. (Perfeito para Gamificação!)

        res.json({ sucesso: true, cupom });
    } catch (e) {
        console.error("Erro ao validar cupom:", e);
        res.status(500).json({ erro: "Erro interno no servidor." });
    }
});

// ==========================================
// ROTA PÚBLICA SEGURA PARA O CRM DO CARDÁPIO DIGITAL
// ==========================================
app.get('/api/vendas/cliente/:telefone', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vendas WHERE cliente_telefone = $1 ORDER BY id DESC', [req.params.telefone]);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar histórico do cliente" });
    }
});

app.post('/api/vendas', async (req, res) => { 
    try { 
        // 👇 AQUI ENSINAMOS O SERVIDOR A OUVIR taxa_entrega, desconto e cupom_usado
        const { produto_nome, valor_total, total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id, taxa_entrega, desconto, cupom_usado } = req.body;
        const valorFinal = valor_total || total || 0;
        const origemFinal = origem || 'Balcão';
        
        const queryDiario = await pool.query("SELECT COALESCE(MAX(numero_diario), 0) + 1 AS proximo FROM vendas WHERE data_diaria = CURRENT_DATE");
        const numeroDiario = queryDiario.rows[0].proximo;

        // 🧠 MOTOR DO CMV: Lendo os insumos do carrinho e somando o custo
        let custoRealTotal = 0;
        let mapBaixaInsumos = {};
        let itensParsed = typeof itens === 'string' ? JSON.parse(itens) : (itens || []);
        
        itensParsed.forEach(item => {
            let qtdProduto = Number(item.quantidade) || 1;
            custoRealTotal += ((Number(item.custo_unitario) || 0) * qtdProduto);
            
            if (item.insumos && Array.isArray(item.insumos)) {
                item.insumos.forEach(ins => {
                    if (ins.id_insumo) {
                        if (!mapBaixaInsumos[ins.id_insumo]) mapBaixaInsumos[ins.id_insumo] = 0;
                        mapBaixaInsumos[ins.id_insumo] += (Number(ins.qtd) * qtdProduto);
                    }
                });
            }
        });

        // 👇 AQUI ENSINAMOS O BANCO A GUARDAR A VENDA COM O CUSTO REAL INCLUSO
        await pool.query(
            `INSERT INTO vendas (produto_nome, valor_total, forma_pagamento, itens, status, cliente_nome, cliente_telefone, cliente_endereco, origem, observacoes, transacao_id, numero_diario, data_diaria, taxa_entrega, desconto, cupom_usado, custo_real) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE, $13, $14, $15, $16)`, 
            [produto_nome, valorFinal, forma_pagamento, JSON.stringify(itensParsed), status || 'Concluída', cliente_nome, cliente_telefone, cliente_endereco, origemFinal, observacoes || '', transacao_id || null, numeroDiario, taxa_entrega || 0, desconto || 0, cupom_usado || null, custoRealTotal]
        );

        // 🥣 BAIXA DO ESTOQUE DE MATÉRIAS-PRIMAS DA FICHA TÉCNICA
        try {
            for (let id_insumo in mapBaixaInsumos) {
                await pool.query("UPDATE insumos SET estoque = estoque - $1 WHERE id = $2", [mapBaixaInsumos[id_insumo], id_insumo]);
            }
        } catch (erroInsumos) { console.error("❌ Erro ao baixar insumos:", erroInsumos); }

        // 👇 BAIXA AUTOMÁTICA DO CUPOM (Incrementa uso e soma receita gerada)
        if (cupom_usado && desconto > 0) {
            try {
                const config = (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'cupons_delivery'")).rows[0];
                if (config) {
                    let cupons = JSON.parse(config.valor);
                    let idx = cupons.findIndex(c => c.codigo.toUpperCase() === cupom_usado.toUpperCase());
                    if (idx !== -1) {
                        cupons[idx].usos_atuais = (cupons[idx].usos_atuais || 0) + 1;
                        cupons[idx].receita_gerada = (parseFloat(cupons[idx].receita_gerada) || 0) + parseFloat(valorFinal);
                        await pool.query("UPDATE configuracoes SET valor = $1 WHERE chave = 'cupons_delivery'", [JSON.stringify(cupons)]);
                    }
                }
            } catch (errCupom) { console.error("Erro ao registrar estatísticas do cupom:", errCupom); }
        }

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

                // 👇 NOVO: Buscamos o tempo de entrega atualizado estipulado na gestão
                const tempoQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'tempo_entrega'");
                const tempoEstimado = tempoQuery.rows.length > 0 ? tempoQuery.rows[0].valor : '45';

                if (config && config.zap_url && config.zap_key && config.zap_instancia) {
                    const primeiroNome = cliente_nome ? cliente_nome.split(' ')[0] : 'Cliente';
                    let textoPronto = '';
                    let enviarMsg = false;

                    // 🛡️ A MÁGICA: Agora o robô trata as 'Mesas' com a mesma mensagem e fidelidade do 'Balcão'
                    if ((origemFinal.toLowerCase().includes('balcão') || origemFinal.toLowerCase().includes('mesas')) && status === 'Concluída' && config.msg_balcao && config.msg_balcao.trim() !== '') {
                        textoPronto = config.msg_balcao.replace(/{nome}/g, primeiroNome).replace(/{pedido}/g, numeroDiario || 'Novo').replace(/{tempo}/g, tempoEstimado);
                        enviarMsg = true;

                        let resumo = `\n\n*🛒 Resumo da Compra:*\n`;
                        try {
                            const itensParsed = typeof itens === 'string' ? JSON.parse(itens) : (itens || []);
                            itensParsed.forEach(item => { 
                                const qtd = item.quantidade || 1;
                                const precoLinha = Number(item.preco) * qtd; // Mostra o valor total daquela linha
                                resumo += `▪️ ${qtd}x ${item.nome.replace('Delivery: ', '')} - R$ ${precoLinha.toFixed(2).replace('.', ',')}\n`; 
                            });
                        } catch(e) {}
                        resumo += `\n*💰 Total:* R$ ${Number(valorFinal).toFixed(2).replace('.', ',')}`;

                        try {
                            const countQuery = await pool.query("SELECT COUNT(*) FROM vendas WHERE cliente_telefone = $1 AND status NOT ILIKE '%cancelad%'", [cliente_telefone]);
                            let pontosTotais = parseInt(countQuery.rows[0].count) || 1;
                            let metaFidelidade = 10;
                            let pontosAtuais = pontosTotais % metaFidelidade;
                            if (pontosAtuais === 0 && pontosTotais > 0) pontosAtuais = metaFidelidade;
                            let bolinhasVerdes = '🟢'.repeat(pontosAtuais);
                            let bolinhasVermelhas = '🔴'.repeat(metaFidelidade - pontosAtuais);
                            resumo += `\n\n🎁 *Seu Progresso de Fidelidade:*\n${bolinhasVerdes}${bolinhasVermelhas}\n`;
                            if (pontosAtuais === metaFidelidade) {
                                resumo += `🎉 *Parabéns!* Você completou sua cartela! O seu próximo pedido tem prêmio!`;
                            } else {
                                resumo += `Faltam apenas ${metaFidelidade - pontosAtuais} pedidos para o seu prêmio!`;
                            }
                        } catch(erroFid) {}
                        textoPronto += resumo;
                    } else if (config.msg_recebido && config.msg_recebido.trim() !== '') {
                        textoPronto = config.msg_recebido.replace(/{nome}/g, primeiroNome).replace(/{pedido}/g, numeroDiario || 'Novo').replace(/{tempo}/g, tempoEstimado);
                        enviarMsg = true;
                    }

                    if (enviarMsg) {
                        const telefoneLimpo = "55" + cliente_telefone.replace(/\D/g, '');
                        const urlZap = config.zap_url.trim().replace(/\/$/, "");
                        const instanciaURL = encodeURIComponent(config.zap_instancia.trim());
                        fetch(`${urlZap}/message/sendText/${instanciaURL}`, {
                            method: 'POST', headers: { 'apikey': config.zap_key.trim(), 'Content-Type': 'application/json' },
                            body: JSON.stringify({ number: telefoneLimpo, text: textoPronto })
                        }).catch(err => console.log("⚠️ Erro msg recebido/balcao (Silenciado):", err.message));
                    }
                }
            } catch (errZap) {}
        }
        res.status(201).json({ sucesso: true });
    } catch (erroGeral) { res.status(500).json({ erro: "Erro interno" }); }
});


// ==========================================
// 🛑 ATUALIZAR STATUS DA VENDA (COM DEVOLUÇÃO DE ESTOQUE E ESTORNO FINANCEIRO)
// ==========================================
app.put('/api/vendas/:id/status', async (req, res) => { 
    try { 
        const novoStatus = req.body.status;
        const retornarEstoque = req.body.retornar_estoque !== false; // Padrão é true
        const idVenda = req.params.id;

        // 1. Pega a venda ANTES de alterar para saber os itens e valores
        const vendaQuery = await pool.query("SELECT * FROM vendas WHERE id = $1", [idVenda]);
        const venda = vendaQuery.rows[0];

        // 2. Altera o status no banco
        await pool.query("UPDATE vendas SET status = $1 WHERE id = $2", [novoStatus, idVenda]); 
        res.json({ sucesso: true }); 

        // ==========================================
        // 🛡️ MÁGICA DA AUDITORIA: ESTORNO E ESTOQUE
        // ==========================================
        if (novoStatus.toLowerCase().includes('cancelad') && venda) {
            // A. Devolve os produtos e insumos para o estoque SE solicitado na tela
            if (retornarEstoque) {
                try {
                    let itensComprados = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : (venda.itens || []);
                    
                    // 1. Devolve as MATÉRIAS-PRIMAS (Motor da Ficha Técnica)
                    let mapDevolucaoInsumos = {};
                    itensComprados.forEach(item => {
                        let qtdProduto = Number(item.quantidade) || 1;
                        if (item.insumos && Array.isArray(item.insumos)) {
                            item.insumos.forEach(ins => {
                                if (ins.id_insumo) {
                                    if (!mapDevolucaoInsumos[ins.id_insumo]) mapDevolucaoInsumos[ins.id_insumo] = 0;
                                    mapDevolucaoInsumos[ins.id_insumo] += (Number(ins.qtd) * qtdProduto);
                                }
                            });
                        }
                    });

                    for (let id_insumo in mapDevolucaoInsumos) {
                        await pool.query("UPDATE insumos SET estoque = estoque + $1 WHERE id = $2", [mapDevolucaoInsumos[id_insumo], id_insumo]);
                    }

                    // 2. Devolve os PRODUTOS SIMPLES (Motor Antigo)
                    const queryEstoque = await pool.query("SELECT id, nome, estoque FROM produtos");
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
                            if (p && p.estoque !== null) {
                                let novoEstoque = Number(p.estoque) + qtd; 
                                await pool.query("UPDATE produtos SET estoque = $1, ativo = true WHERE id = $2", [novoEstoque, p.id]);
                            }
                        }
                    }
                } catch(e) { console.error("Erro no estoque do estorno:", e); }
            }

            // B. Estorno Financeiro Inteligente (Verifica a máquina do tempo do caixa)
            try {
                const caixaQuery = await pool.query("SELECT status FROM controle_caixa WHERE data_abertura <= $1 AND (data_fechamento >= $1 OR data_fechamento IS NULL) ORDER BY id DESC LIMIT 1", [venda.data_hora]);
                if (caixaQuery.rows.length > 0 && caixaQuery.rows[0].status === 'Fechado') {
                    let catResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'deducoes' LIMIT 1");
                    const catId = catResult.rows[0]?.id;
                    
                    let contaId = null;
                    if (venda.forma_pagamento.toLowerCase().includes('dinheiro')) {
                        const c = await pool.query("SELECT id FROM fin_contas_bancarias WHERE nome ILIKE '%Caixa Físico%' LIMIT 1");
                        if(c.rows.length>0) contaId = c.rows[0].id;
                    } else {
                        const c = await pool.query("SELECT id FROM fin_contas_bancarias WHERE nome ILIKE '%Transição%' LIMIT 1");
                        if(c.rows.length>0) contaId = c.rows[0].id;
                    }

                    const dataFormatada = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                    await pool.query(`
                        INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                        VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)
                    `, [`[Estorno] Cancelamento Pedido #${venda.id}`, venda.valor_total, dataFormatada, catId, contaId]);
                }
            } catch(e) { console.error("Erro no estorno financeiro:", e); }
        }
        // ==========================================

        // ==========================================
        // MENSAGERIA DE WHATSAPP (MANTIDO INTACTO)
        // ==========================================
        if (venda && venda.cliente_telefone && venda.cliente_telefone.trim() !== '') {
            const configQuery = await pool.query('SELECT * FROM integracoes_config LIMIT 1');
            const config = configQuery.rows[0];

            // 👇 NOVO: Buscamos o tempo de entrega estipulado na gestão
            const tempoQuery = await pool.query("SELECT valor FROM configuracoes WHERE chave = 'tempo_entrega'");
            const tempoEstimado = tempoQuery.rows.length > 0 ? tempoQuery.rows[0].valor : '45';

            if (config && config.zap_url && config.zap_key && config.zap_instancia) {
                let textoMensagem = null;
                if (novoStatus === 'A Preparar' && config.msg_aceito) textoMensagem = config.msg_aceito;
                else if (novoStatus === 'Saiu p/ Entrega' && config.msg_entrega) textoMensagem = config.msg_entrega;
                else if (novoStatus === 'Entregue' && config.msg_concluido) textoMensagem = config.msg_concluido;

                if (textoMensagem) {
                    const primeiroNome = venda.cliente_nome ? venda.cliente_nome.split(' ')[0] : 'Cliente';
                    // 👇 NOVO: Substitui a variável {tempo} pelo tempo real no texto
                    let textoPronto = textoMensagem.replace(/{nome}/g, primeiroNome).replace(/{pedido}/g, venda.numero_diario || venda.id).replace(/{tempo}/g, tempoEstimado);

                    if (novoStatus === 'A Preparar') {
                        let resumo = `\n\n*🛒 Resumo do seu pedido:*\n`;
                        try {
                            const itens = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens;
                            itens.forEach(item => { 
                                const qtd = item.quantidade || 1;
                                const precoLinha = Number(item.preco) * qtd; // Multiplica pela quantidade para não confundir o cliente
                                resumo += `▪️ ${qtd}x ${item.nome.replace('Delivery: ', '')} - R$ ${precoLinha.toFixed(2).replace('.', ',')}\n`; 
                            });
                        } catch(e) {}
                        resumo += `\n*💰 Total:* R$ ${Number(venda.valor_total).toFixed(2).replace('.', ',')}`;
                        resumo += `\n*💳 Pagamento:* ${venda.forma_pagamento}`;
                        if (venda.cliente_endereco && !venda.cliente_endereco.includes('Retirada')) resumo += `\n*📍 Entrega:* ${venda.cliente_endereco}`;
                        else resumo += `\n*🏬 Retirada na Loja*`;
                        if (venda.observacoes && venda.observacoes.trim() !== '') resumo += `\n*📝 Obs:* ${venda.observacoes}`;

                        try {
                            const countQuery = await pool.query("SELECT COUNT(*) FROM vendas WHERE cliente_telefone = $1 AND status NOT ILIKE '%cancelad%'", [venda.cliente_telefone]);
                            let pontosTotais = parseInt(countQuery.rows[0].count) || 1;
                            let metaFidelidade = 10; 
                            let pontosAtuais = pontosTotais % metaFidelidade; 
                            if (pontosAtuais === 0 && pontosTotais > 0) pontosAtuais = metaFidelidade;

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
// 💳 CORRIGIR FORMA DE PAGAMENTO (AUDITORIA INTELIGENTE)
// ==========================================
app.put('/api/vendas/:id/pagamento', async (req, res) => {
    try {
        const { forma_pagamento } = req.body;
        
        // 1. Pega a venda ANTES de alterar para comparar as formas de pagamento
        const vendaQuery = await pool.query("SELECT * FROM vendas WHERE id = $1", [req.params.id]);
        const venda = vendaQuery.rows[0];
        if (!venda) return res.status(404).json({erro: "Venda não encontrada"});

        // 2. Salva a nova forma de pagamento
        await pool.query("UPDATE vendas SET forma_pagamento = $1 WHERE id = $2", [forma_pagamento, req.params.id]);
        res.json({ sucesso: true });

        // 🛡️ MÁGICA DA AUDITORIA: Transferência retroativa de saldo
        try {
            const caixaQuery = await pool.query("SELECT status FROM controle_caixa WHERE data_abertura <= $1 AND (data_fechamento >= $1 OR data_fechamento IS NULL) ORDER BY id DESC LIMIT 1", [venda.data_hora]);
            if (caixaQuery.rows.length > 0 && caixaQuery.rows[0].status === 'Fechado') {
                // O caixa já tinha fechado. Precisamos mover o dinheiro manualmente!
                const eraDinheiro = venda.forma_pagamento.toLowerCase().includes('dinheiro');
                const virouDinheiro = forma_pagamento.toLowerCase().includes('dinheiro');
                
                if (eraDinheiro !== virouDinheiro) {
                    const contaFisico = (await pool.query("SELECT id FROM fin_contas_bancarias WHERE nome ILIKE '%Caixa Físico%' LIMIT 1")).rows[0]?.id;
                    const contaTrans = (await pool.query("SELECT id FROM fin_contas_bancarias WHERE nome ILIKE '%Transição%' LIMIT 1")).rows[0]?.id;
                    let catResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'movimentacao_interna' LIMIT 1");
                    const catId = catResult.rows[0]?.id;
                    const dataFormatada = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

                    if (eraDinheiro && !virouDinheiro) {
                        // Tira do Físico (Despesa), põe na Transição (Receita)
                        await pool.query("INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id) VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)", [`[Auditoria] Correção Pagamento #${venda.id}`, venda.valor_total, dataFormatada, catId, contaFisico]);
                        await pool.query("INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id) VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)", [`[Auditoria] Correção Pagamento #${venda.id}`, venda.valor_total, dataFormatada, catId, contaTrans]);
                    } else if (!eraDinheiro && virouDinheiro) {
                        // Tira da Transição (Despesa), põe no Físico (Receita)
                        await pool.query("INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id) VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)", [`[Auditoria] Correção Pagamento #${venda.id}`, venda.valor_total, dataFormatada, catId, contaTrans]);
                        await pool.query("INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id) VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)", [`[Auditoria] Correção Pagamento #${venda.id}`, venda.valor_total, dataFormatada, catId, contaFisico]);
                    }
                }
            }
        } catch(e) { console.error("Erro na auditoria de pagamento", e); }

    } catch (e) {
        console.error("Erro ao atualizar pagamento:", e);
        res.status(500).json({ erro: "Erro ao atualizar pagamento" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM usuarios WHERE (username = $1 OR email = $1) AND senha = $2', [req.body.username, req.body.senha]);
        if (resultado.rows.length > 0) {
            const usuario = resultado.rows[0];
            // Gera o crachá oficial de 8 horas
            const tokenReal = jwt.sign({ id: usuario.id, cargo: usuario.cargo }, SEGREDO_JWT, { expiresIn: '8h' });
            res.json({ sucesso: true, token: tokenReal, cargo: usuario.cargo, usuario_id: usuario.id });
        } else {
            res.status(401).json({ sucesso: false, erro: "Incorreto" });
        }
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

// ==========================================
// 🏆 NOVO: RANKING DOS TOP 3 ADICIONAIS MAIS VENDIDOS
// ==========================================
app.get('/api/ranking/adicionais', async (req, res) => {
    try {
        const vendasQuery = await pool.query(`SELECT itens FROM vendas WHERE status NOT ILIKE '%cancelad%'`);
        const contagem = {};
        
        vendasQuery.rows.forEach(venda => {
            let itens = venda.itens;
            if (typeof itens === 'string') {
                try { itens = JSON.parse(itens); } catch(e) { return; }
            }
            if (Array.isArray(itens)) {
                itens.forEach(item => {
                    const nomeProduto = item.nome || '';
                    // Extrai apenas o que está entre parênteses (ex: "Açaí (Morango, Nutella)")
                    if (nomeProduto.includes('(') && nomeProduto.includes(')')) {
                        const complementosStr = nomeProduto.substring(nomeProduto.indexOf('(') + 1, nomeProduto.lastIndexOf(')'));
                        const listaComplementos = complementosStr.split(',').map(a => a.trim()).filter(a => a !== '');
                        
                        listaComplementos.forEach(adc => {
                            contagem[adc] = (contagem[adc] || 0) + (item.quantidade || 1);
                        });
                    }
                });
            }
        });
        
        // Ordena do maior para o menor e pega os 3 primeiros
        const top3 = Object.entries(contagem)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(entry => entry[0]);
            
        res.json(top3);
    } catch (e) {
        console.error("Erro no ranking de adicionais:", e);
        res.status(500).json({ erro: "Erro ao buscar ranking" });
    }
});

app.get('/api/caixa/status', async (req, res) => { try { res.json((await pool.query('SELECT * FROM controle_caixa ORDER BY id DESC LIMIT 1')).rows[0] || { status: 'Fechado' }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });
app.post('/api/caixa/abrir', async (req, res) => { try { res.json({ sucesso: true, caixa: (await pool.query("INSERT INTO controle_caixa (valor_inicial, status) VALUES ($1, 'Aberto') RETURNING *", [req.body.valor_inicial || 0])).rows[0] }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });


// ==========================================
// 🔒 FECHAMENTO DE CAIXA COM INJEÇÃO FINANCEIRA (CONTA DE TRANSIÇÃO, RETIRADAS E SUPRIMENTOS)
// ==========================================
app.put('/api/caixa/fechar/:id', async (req, res) => {
    try {
        // 1. Fecha o caixa e captura a data exata no banco de dados
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

        // 3. 👇 BUSCA TODAS AS MOVIMENTAÇÕES (Sangrias e Suprimentos) deste caixa
        await pool.query("ALTER TABLE movimentacoes_caixa ADD COLUMN IF NOT EXISTS categoria_id INTEGER");
        const movQuery = await pool.query(`
            SELECT tipo, valor, motivo, categoria_id FROM movimentacoes_caixa 
            WHERE caixa_id = $1
        `, [caixa.id]);

        // 4. Garante que a Categoria "Invisível" (Conta Transitória) exista para não duplicar no DRE
        let catResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'movimentacao_interna' LIMIT 1");
        if (catResult.rows.length === 0) {
            catResult = await pool.query("INSERT INTO fin_categorias (nome, tipo, dre_ref) VALUES ('Transferência / Fechamento', 'Receita', 'movimentacao_interna') RETURNING id");
        }
        const categoriaId = catResult.rows[0].id;

        // 5. Garante que as contas de Banco existem
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

        // 6. Injeta no Financeiro silenciosamente
        const promessasLancamentos = [];

        // 🛡️ A VACINA ANTI-FUSO HORÁRIO: Extrai a data baseando-se estritamente no fuso de São Paulo/Brasília
        const dataFormatada = new Date(caixa.data_fechamento).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // Resulta sempre em "YYYY-MM-DD" perfeito

        // A. Injeta as Vendas em Dinheiro
        if (totalDinheiro > 0) {
            promessasLancamentos.push(pool.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)
            `, [`Fechamento de Caixa #${caixa.id} (Dinheiro)`, totalDinheiro, dataFormatada, categoriaId, contaFisicoId]));
        }

        // B. Injeta as Vendas Digitais
        if (totalDigital > 0) {
            promessasLancamentos.push(pool.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)
            `, [`Fechamento de Caixa #${caixa.id} (Cartões/Pix/Ifood)`, totalDigital, dataFormatada, categoriaId, contaTransicaoId]));
        }

        // C. Injeta Sangrias e Suprimentos com as categorias corretas (Estilo Yampa)
        movQuery.rows.forEach(mov => {
            const ehSangria = mov.tipo.toLowerCase() === 'sangria';
            const tipoFin = ehSangria ? 'Despesa' : 'Receita';
            const desc = ehSangria ? `[Sangria] ${mov.motivo || 'Retirada de Caixa'}` : `[Suprimento] ${mov.motivo || 'Entrada de Caixa'}`;
            const catParaUsar = mov.categoria_id ? mov.categoria_id : categoriaId; 

            promessasLancamentos.push(pool.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', $4, $5, $6)
            `, [desc, parseFloat(mov.valor), dataFormatada, tipoFin, catParaUsar, contaFisicoId]));
        });

        await Promise.all(promessasLancamentos);

        res.json({ sucesso: true, caixa });
    } catch (e) {
        console.error("Erro no fechamento com financeiro:", e);
        res.status(500).json({ erro: "Erro interno no fechamento" });
    }
});

app.post('/api/caixa/movimentacao', async (req, res) => { 
    try { 
        // 🛡️ Garante que a coluna da categoria exista no banco
        await pool.query("ALTER TABLE movimentacoes_caixa ADD COLUMN IF NOT EXISTS categoria_id INTEGER");
        res.json({ 
            sucesso: true, 
            movimentacao: (await pool.query(
                "INSERT INTO movimentacoes_caixa (caixa_id, tipo, valor, motivo, categoria_id) VALUES ($1, $2, $3, $4, $5) RETURNING *", 
                [req.body.caixa_id, req.body.tipo, req.body.valor, req.body.motivo, req.body.categoria_id || null]
            )).rows[0] 
        }); 
    } catch (e) { res.status(500).json({ erro: "Erro" }); } 
});

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
    // 1. Corrige o fuso horário na busca do banco de dados (para o mês não virar meia-noite antes da hora)
    const caixas = (await pool.query(`SELECT * FROM controle_caixa WHERE status = 'Fechado' AND TO_CHAR(data_fechamento AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $1 ORDER BY data_fechamento DESC`, [req.query.mes])).rows;
    let historico = [];
    for (let c of caixas) {
        const vendasDinheiro = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE forma_pagamento ILIKE '%dinheiro%' AND data_hora >= $1 AND data_hora <= $2`, [c.data_abertura, c.data_fechamento])).rows[0].total) || 0;
        const vendasCartao = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE (forma_pagamento ILIKE '%cartão%' OR forma_pagamento ILIKE '%cartao%') AND data_hora >= $1 AND data_hora <= $2`, [c.data_abertura, c.data_fechamento])).rows[0].total) || 0;
        const vendasPix = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas WHERE forma_pagamento ILIKE '%pix%' AND data_hora >= $1 AND data_hora <= $2`, [c.data_abertura, c.data_fechamento])).rows[0].total) || 0;
        const despesas = parseFloat((await pool.query(`SELECT COALESCE(SUM(valor), 0) as total FROM movimentacoes_caixa WHERE caixa_id = $1 AND LOWER(TRIM(tipo)) = 'sangria'`, [c.id])).rows[0].total) || 0;
        
        // 2. O PULO DO GATO: Forçamos a formatação em texto usando o fuso horário oficial de São Paulo / Brasília
        historico.push({ 
            id: c.id, 
            dataAbertura: c.data_abertura ? new Date(c.data_abertura).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro', 
            dataFechamento: c.data_fechamento ? new Date(c.data_fechamento).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Sem registro', 
            totalCartao: vendasCartao, 
            totalDinheiro: vendasDinheiro, 
            totalPix: vendasPix, 
            totalDespesas: despesas 
        });
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

app.post('/api/mesas', async (req, res) => { 
    try { 
        const novaMesa = (await pool.query("INSERT INTO mesas_ativas (numero, itens) VALUES ($1, $2) RETURNING *", [req.body.numero, JSON.stringify(req.body.itens || [])])).rows[0]; 
        io.emit('novo_pedido_kanban', { id: 'Mesa/Comanda ' + req.body.numero, cliente: 'Novo Lançamento', status: 'A Preparar' }); // 📢 Mágica: Avisa a Cozinha!
        res.status(201).json(novaMesa); 
    } catch (e) { res.status(500).json({ erro: "Erro" }); } 
});

app.put('/api/mesas/:id', async (req, res) => { 
    try { 
        const mesa = (await pool.query("UPDATE mesas_ativas SET itens = $1 WHERE id = $2 RETURNING *", [JSON.stringify(req.body.itens), req.params.id])).rows[0]; 
        io.emit('novo_pedido_kanban', { id: 'Mesa/Comanda ' + mesa.numero, cliente: 'Adição de Itens', status: 'A Preparar' }); // 📢 Mágica: Avisa a Cozinha!
        res.json(mesa); 
    } catch (e) { res.status(500).json({ erro: "Erro" }); } 
});

app.delete('/api/mesas/:id', async (req, res) => { try { await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

// ==========================================
// 🖨️ PONTE DE IMPRESSÃO REMOTA (CELULAR -> PC)
// ==========================================
app.post('/api/imprimir/comanda', async (req, res) => {
    try {
        // O servidor recebe do celular e "grita" para o PC
        io.emit('imprimir_pedido_pc', req.body); 
        res.json({ sucesso: true });
    } catch (e) { 
        res.status(500).json({ erro: "Erro ao enviar comando de impressão" }); 
    }
});

app.delete('/api/mesas/:id', async (req, res) => { try { await pool.query('DELETE FROM mesas_ativas WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({ erro: "Erro" }); } });

app.put('/api/produtos/:id/estoque', async (req, res) => { try { await pool.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [req.body.estoque, req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro: "Erro"}); } });
app.get('/api/status', (req, res) => res.json({ mensagem: "✅ Motor v5.0 pronto!" }));

// ==========================================
// 🥣 API DE INSUMOS (MATÉRIAS-PRIMAS)
// ==========================================
app.get('/api/insumos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM insumos ORDER BY nome ASC')).rows); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.post('/api/insumos', async (req, res) => { try { res.json({ sucesso: true, insumo: (await pool.query('INSERT INTO insumos (nome, unidade, custo, estoque) VALUES ($1, $2, $3, $4) RETURNING *', [req.body.nome, req.body.unidade, req.body.custo || 0, req.body.estoque || 0])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.delete('/api/insumos/:id', async (req, res) => { try { await pool.query('DELETE FROM insumos WHERE id = $1', [req.params.id]); res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro:"Erro"}); }});

// 👇 NOVO: Rota para sobrescrever o estoque na Conferência (Inventário)
app.put('/api/insumos/:id/sincronizar', async (req, res) => {
    try {
        await pool.query('UPDATE insumos SET estoque = $1 WHERE id = $2', [parseFloat(req.body.estoque) || 0, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) { res.status(500).json({erro: "Erro ao sincronizar estoque"}); }
});

// 👇 NOVO: Rota para Lançar Compra / Abastecer Estoque
app.put('/api/insumos/:id/abastecer', async (req, res) => {
    try {
        const { quantidade, valor_total } = req.body;
        const qtd = parseFloat(quantidade);
        const valor = parseFloat(valor_total);
        
        if (isNaN(qtd) || qtd <= 0 || isNaN(valor) || valor < 0) return res.status(400).json({erro: "Valores inválidos"});

        // A MÁGICA FINANCEIRA: Descobre o novo preço de custo unitário baseado na última compra
        const custo_unitario = valor / qtd;

        // Atualiza o banco: Soma a quantidade na geladeira e atualiza o custo por grama/unidade
        const result = await pool.query(
            'UPDATE insumos SET estoque = COALESCE(estoque, 0) + $1, custo = $2 WHERE id = $3 RETURNING *',
            [qtd, custo_unitario, req.params.id]
        );
        res.json({ sucesso: true, insumo: result.rows[0] });
    } catch (e) {
        console.error("Erro ao abastecer:", e);
        res.status(500).json({erro: "Erro ao abastecer insumo"});
    }
});

app.get('/api/produtos', async (req, res) => { try { res.json((await pool.query('SELECT * FROM produtos ORDER BY ordem ASC, id ASC')).rows.map(p => ({...p, preco: parseFloat(p.preco)}))); } catch (e) { res.status(500).json({erro:"Erro"}); }});
app.put('/api/produtos/ordem', async (req, res) => { try { for (let p of req.body) { await pool.query('UPDATE produtos SET ordem = $1 WHERE id = $2', [p.ordem, p.id]); } res.json({ sucesso: true }); } catch (e) { res.status(500).json({erro: "Erro"}); } });
app.post('/api/produtos', async (req, res) => { try { res.json({ sucesso: true, produto: (await pool.query('INSERT INTO produtos (nome, descricao, preco, emoji, categoria, grupos_ids, imagem_url, venda_por_peso, tag, tipo_promocao, valor_promocao, promo_dias, promo_inicio, promo_fim, promo_pdv, categorias_adicionais, controlar_estoque, mostrar_estoque, custo, insumos_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *', [req.body.nome, req.body.descricao, req.body.preco, req.body.emoji, req.body.categoria || 'Outros', req.body.grupos_ids || [], req.body.imagem_url, req.body.venda_por_peso || false, req.body.tag || '', req.body.tipo_promocao || 'nenhuma', req.body.valor_promocao || 0, req.body.promo_dias || '', req.body.promo_inicio || '', req.body.promo_fim || '', req.body.promo_pdv || false, JSON.stringify(req.body.categorias_adicionais || []), req.body.controlar_estoque || false, req.body.mostrar_estoque || false, req.body.custo || 0, req.body.insumos_json || '[]'])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
app.put('/api/produtos/:id', async (req, res) => { try { res.json({ sucesso: true, produto: (await pool.query('UPDATE produtos SET nome = $1, descricao = $2, preco = $3, emoji = $4, categoria = $5, grupos_ids = $6, imagem_url = $7, venda_por_peso = $8, tag = $9, tipo_promocao = $10, valor_promocao = $11, promo_dias = $12, promo_inicio = $13, promo_fim = $14, promo_pdv = $15, categorias_adicionais = $16, controlar_estoque = $17, mostrar_estoque = $18, custo = $19, insumos_json = $20 WHERE id = $21 RETURNING *', [req.body.nome, req.body.descricao, req.body.preco, req.body.emoji, req.body.categoria || 'Outros', req.body.grupos_ids || [], req.body.imagem_url, req.body.venda_por_peso || false, req.body.tag || '', req.body.tipo_promocao || 'nenhuma', req.body.valor_promocao || 0, req.body.promo_dias || '', req.body.promo_inicio || '', req.body.promo_fim || '', req.body.promo_pdv || false, JSON.stringify(req.body.categorias_adicionais || []), req.body.controlar_estoque || false, req.body.mostrar_estoque || false, req.body.custo || 0, req.body.insumos_json || '[]', req.params.id])).rows[0] }); } catch (e) { res.status(500).json({erro:"Erro"}); } });
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

app.put('/api/categorias/:id', async (req, res) => { 
    try { 
        const { nome, mostrar_cardapio, dias_semana, hora_inicio, hora_fim } = req.body;
        
        // Se a requisição enviar um 'nome', significa que veio do Modal Avançado. 
        if (nome !== undefined) {
            await pool.query(
                'UPDATE categorias SET nome = $1, mostrar_cardapio = $2, dias_semana = $3, hora_inicio = $4, hora_fim = $5 WHERE id = $6', 
                [nome, mostrar_cardapio !== false, dias_semana || '', hora_inicio || '', hora_fim || '', req.params.id]
            );
        } else {
            // Se não enviou 'nome', é só o clique rápido da chavinha de visibilidade.
            await pool.query(
                'UPDATE categorias SET mostrar_cardapio = $1 WHERE id = $2', 
                [req.body.mostrar_cardapio !== false, req.params.id]
            );
        }
        res.json({ sucesso: true }); 
    } catch (e) { 
        console.error("Erro ao atualizar categoria:", e);
        res.status(500).json({erro:"Erro ao atualizar"}); 
    } 
});

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

app.get('/api/crm/clientes', verificarToken, async (req, res) => {
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
        msg_boas_vindas TEXT, msg_recebido TEXT, msg_aceito TEXT, msg_entrega TEXT, msg_concluido TEXT, msg_balcao TEXT
    );
`).then(async () => {
    await pool.query('ALTER TABLE integracoes_config ADD COLUMN IF NOT EXISTS msg_recebido TEXT');
    await pool.query('ALTER TABLE integracoes_config ADD COLUMN IF NOT EXISTS msg_balcao TEXT');
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

        const valorFinal = Number(req.body.valor);
        if (valorFinal <= 0) return res.status(400).json({ erro: "Valor inválido para Pix." });

        // 🛡️ Prevenção 1: Sanitização do Nome (Remove emojis e caracteres estranhos)
        let nomeLimpo = req.body.cliente_nome ? req.body.cliente_nome.trim().replace(/[^a-zA-ZÀ-ÿ\s]/g, '') : "Cliente";
        if (nomeLimpo.length < 2) nomeLimpo = "Cliente Icesoft";

        // 🛡️ Prevenção 2: E-mail Dinâmico para fugir do Anti-Spam
        const emailDinamico = `pedido.${Date.now()}@icesoft.com.br`;

        // 🛡️ Prevenção 3: Chave de segurança à prova de colisões
        const chaveSeguranca = "ICE-" + Date.now() + "-" + Math.floor(Math.random() * 10000);

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${mpToken}`, 
                'X-Idempotency-Key': chaveSeguranca, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                transaction_amount: valorFinal, 
                description: "Pedido Icesoft Delivery", 
                payment_method_id: "pix", 
                payer: { 
                    email: emailDinamico, 
                    first_name: nomeLimpo 
                } 
            })
        });
        
        const data = await mpResponse.json();
        
        if (data.error || !data.point_of_interaction) {
            console.error("⚠️ Recusa do Mercado Pago:", data);
            return res.status(500).json({ erro: "Falha ao gerar o Pix." });
        }
        
        res.json({ 
            sucesso: true, 
            transacao_id: data.id, 
            qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64, 
            qr_code_copia_cola: data.point_of_interaction.transaction_data.qr_code 
        });
    } catch (e) { 
        console.error("Erro API Pix:", e);
        res.status(500).json({ erro: "Erro interno no servidor." }); 
    }
});

app.post('/api/pagamento/webhook', async (req, res) => {
    res.status(200).send("OK");
    try {
        if (req.body.type === 'payment') {
            const pagamentoId = req.body.data.id;
            const mpToken = (await pool.query("SELECT valor FROM configuracoes WHERE chave = 'mp_access_token'")).rows[0]?.valor;
            const pgtoInfo = await (await fetch(`https://api.mercadopago.com/v1/payments/${pagamentoId}`, { headers: { 'Authorization': `Bearer ${mpToken}` } })).json();
            if (pgtoInfo.status === 'approved') {
                
                // 🛡️ VACINA ANTI-RECUO: Só atualiza se o pedido não estiver nas colunas avançadas
                const resultado = await pool.query(
                    "UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1 AND status NOT IN ('Pendente Delivery', 'A Preparar', 'Saiu p/ Entrega', 'Entregue', 'Concluída') AND status NOT ILIKE '%cancelad%' RETURNING numero_diario, cliente_nome", 
                    [pagamentoId.toString()]
                );
                
                console.log(`✅ Pagamento Pix ${pagamentoId} APROVADO via Webhook!`);

                // Só toca a campainha no Kanban se a vacina permitiu a atualização
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
            
            // 🛡️ VACINA ANTI-RECUO também na checagem da tela do cliente
            await pool.query(
                "UPDATE vendas SET status = 'Pendente Delivery' WHERE transacao_id = $1 AND status NOT IN ('Pendente Delivery', 'A Preparar', 'Saiu p/ Entrega', 'Entregue', 'Concluída') AND status NOT ILIKE '%cancelad%'", 
                [req.params.id.toString()]
            );
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
app.get('/api/financeiro/resumo', verificarToken, async (req, res) => {
    try {
        // 👇 CORREÇÃO: "Até o último dia do mês atual" (Engloba o mês todo + tudo que está atrasado!)
        const pagarQuery = await pool.query(`
            SELECT COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            LEFT JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Despesa' AND l.status = 'Pendente' 
            AND (c.dre_ref IS NULL OR c.dre_ref != 'movimentacao_interna')
            AND l.data_vencimento <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')
        `);

        const receberQuery = await pool.query(`
            SELECT COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            LEFT JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Receita' AND l.status = 'Pendente'
            AND (c.dre_ref IS NULL OR c.dre_ref != 'movimentacao_interna')
            AND l.data_vencimento <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')
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

// 2. Criar um Novo Lançamento (Único, Parcelado ou Recorrente)
app.post('/api/financeiro/lancamentos', async (req, res) => {
    try {
        // 🛡️ Prepara o banco de dados para a nova inteligência de repetição
        await pool.query("ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS grupo_recorrencia VARCHAR(100)");

        const { descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id, recorrencia_tipo, qtd_meses } = req.body;
        
        const tipoRec = recorrencia_tipo || 'unico';
        const qtd = (tipoRec !== 'unico') ? (parseInt(qtd_meses) || 1) : 1;
        
        // 🧠 O DNA DA FAMÍLIA: Cria um código único se a conta for repetida
        const grupoRec = (tipoRec !== 'unico') ? 'REC-' + Date.now() : null; 
        
        const promessas = [];
        const [ano, mes, dia] = data_vencimento.split('-');
        const dataBase = new Date(ano, mes - 1, dia);

        for (let i = 0; i < qtd; i++) {
            let descFinal = descricao;
            let statusFinal = (i === 0) ? (status || 'Pendente') : 'Pendente'; 

            if (tipoRec === 'parcelado') {
                descFinal = `${descricao} (${i + 1}/${qtd})`;
            }

            const novaData = new Date(dataBase.getFullYear(), dataBase.getMonth() + i, dataBase.getDate());
            const dataStr = `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, '0')}-${String(novaData.getDate()).padStart(2, '0')}`;

            promessas.push(
                pool.query(`
                    INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id, recorrente, grupo_recorrencia)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
                `, [descFinal, valor, dataStr, statusFinal, tipo, categoria_id || null, conta_id || null, tipoRec !== 'unico', grupoRec])
            );
        }
        
        await Promise.all(promessas);
        res.status(201).json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao criar lançamento" });
    }
});

// 3. Buscar Lançamentos com Filtros Inteligentes (Data, Banco, Categoria, Busca e CARDS)
app.get('/api/financeiro/lancamentos', async (req, res) => {
    try {
        const { banco_id, categoria_id, data_inicio, data_fim, busca, filtro_card } = req.query;
        
        let query = `SELECT * FROM fin_lancamentos WHERE 1=1`;
        let params = [];
        let paramCount = 1;

        if (banco_id) { query += ` AND conta_id = $${paramCount}`; params.push(banco_id); paramCount++; }
        
        // 👇 NOVO: A inteligência do filtro por Plano de Contas
        if (categoria_id) { query += ` AND categoria_id = $${paramCount}`; params.push(categoria_id); paramCount++; }
        
        if (data_inicio) { query += ` AND data_vencimento >= $${paramCount}`; params.push(data_inicio); paramCount++; }
        if (data_fim) { query += ` AND data_vencimento <= $${paramCount}`; params.push(data_fim); paramCount++; }
        if (busca) { query += ` AND descricao ILIKE $${paramCount}`; params.push(`%${busca}%`); paramCount++; }

        // Filtragem pesada de status 
        if (filtro_card === 'pagar') {
            query += ` AND tipo = 'Despesa' AND status = 'Pendente'`;
        } else if (filtro_card === 'receber') {
            query += ` AND tipo = 'Receita' AND status = 'Pendente'`;
        }

        query += ` ORDER BY data_vencimento DESC LIMIT 200`;
        
        const lista = await pool.query(query, params);
        res.json(lista.rows);
    } catch (e) {
        console.error("Erro ao buscar lançamentos:", e);
        res.status(500).json({ erro: "Erro ao buscar lançamentos" });
    }
});

// 3.5 Atualizar/Editar um Lançamento (AGORA COM SUPORTE A CONTAS ANTIGAS ÓRFÃS)
app.put('/api/financeiro/lancamentos/:id', async (req, res) => {
    try {
        const { descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id, aplicar_futuros } = req.body;
        
        const itemAtual = (await pool.query('SELECT * FROM fin_lancamentos WHERE id = $1', [req.params.id])).rows[0];

        // Se o usuário clicou em SIM para atualizar futuros:
        if (aplicar_futuros && itemAtual && itemAtual.recorrente) {
            
            if (itemAtual.grupo_recorrencia) {
                // 1A. CONTAS NOVAS: Acha pelo DNA exato
                await pool.query(`
                    UPDATE fin_lancamentos 
                    SET valor = $1, categoria_id = $2, conta_id = $3
                    WHERE grupo_recorrencia = $4 AND data_vencimento >= $5
                `, [valor, categoria_id || null, conta_id || null, itemAtual.grupo_recorrencia, itemAtual.data_vencimento]);
            } else {
                // 1B. CONTAS ANTIGAS (Plano B): Acha contas órfãs ignorando numerações do tipo "(1/12)"
                const descBase = itemAtual.descricao.replace(/\s\(\d+\/\d+\)$/, ''); 
                await pool.query(`
                    UPDATE fin_lancamentos 
                    SET valor = $1, categoria_id = $2, conta_id = $3
                    WHERE descricao LIKE $4 AND valor = $5 AND data_vencimento >= $6 AND recorrente = true
                `, [valor, categoria_id || null, conta_id || null, descBase + '%', itemAtual.valor, itemAtual.data_vencimento]);
            }
            
            // 2. Garante que o status/descrição seja atualizado apenas no item clicado
            await pool.query(`
                UPDATE fin_lancamentos 
                SET descricao = $1, data_vencimento = $2, status = $3, tipo = $4
                WHERE id = $5
            `, [descricao, data_vencimento, status, tipo, req.params.id]);
            
        } else {
            // Edição Única (clicou em NÃO)
            await pool.query(`
                UPDATE fin_lancamentos 
                SET descricao = $1, valor = $2, data_vencimento = $3, status = $4, tipo = $5, categoria_id = $6, conta_id = $7
                WHERE id = $8
            `, [descricao, valor, data_vencimento, status, tipo, categoria_id || null, conta_id || null, req.params.id]);
        }
        
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar lançamento" });
    }
});

// 4. Deletar Lançamento (AGORA COM SUPORTE A CONTAS ANTIGAS ÓRFÃS)
app.delete('/api/financeiro/lancamentos/:id', async (req, res) => {
    try {
        const { futuros } = req.query;
        const itemAtual = (await pool.query('SELECT * FROM fin_lancamentos WHERE id = $1', [req.params.id])).rows[0];

        if (futuros === 'true' && itemAtual && itemAtual.recorrente) {
            
            if (itemAtual.grupo_recorrencia) {
                // 1A. CONTAS NOVAS: Apaga a família pelo DNA
                await pool.query('DELETE FROM fin_lancamentos WHERE grupo_recorrencia = $1 AND data_vencimento >= $2', [itemAtual.grupo_recorrencia, itemAtual.data_vencimento]);
            } else {
                // 1B. CONTAS ANTIGAS (Plano B): Caça as órfãs similares para apagar juntas
                const descBase = itemAtual.descricao.replace(/\s\(\d+\/\d+\)$/, '');
                await pool.query('DELETE FROM fin_lancamentos WHERE descricao LIKE $1 AND valor = $2 AND data_vencimento >= $3 AND recorrente = true', [descBase + '%', itemAtual.valor, itemAtual.data_vencimento]);
            }
            
        } else {
            // Apaga uma linha única
            await pool.query('DELETE FROM fin_lancamentos WHERE id = $1', [req.params.id]);
        }
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao deletar lançamento" });
    }
});

// 5. Buscar Categorias Ordenadas por Drag-and-Drop (ESTRUTURA PAI E FILHO YAMPA)
app.get('/api/financeiro/categorias', async (req, res) => {
    try {
        await pool.query("ALTER TABLE fin_categorias ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 0");
        
        // 🧹 LIMPEZA INTELIGENTE: Remove os números velhos "1.1." "2.1" do banco de dados automaticamente
        await pool.query(`UPDATE fin_categorias SET nome = REGEXP_REPLACE(nome, '^[0-9]+\\.[0-9]+[\\.\\s\\-]*', '') WHERE nome ~ '^[0-9]+\\.[0-9]+[\\.\\s\\-]*'`);

        const check = await pool.query('SELECT COUNT(*) FROM fin_categorias');
        if (parseInt(check.rows[0].count) === 0) { 
            await pool.query(`
                INSERT INTO fin_categorias (nome, tipo, dre_ref, ordem) VALUES
                ('Loja Física (Balcão/Mesa)', 'Receita', 'receita_bruta', 1),
                ('Delivery (iFood, WhatsApp)', 'Receita', 'receita_bruta', 2),
                ('Impostos e DAS', 'Despesa', 'deducoes', 3),
                ('Taxas de Cartão/Maquininha', 'Despesa', 'deducoes', 4),
                ('Insumos e Bases (Leite, Açaí)', 'Despesa', 'cmv', 5),
                ('Embalagens', 'Despesa', 'cmv', 6),
                ('Bebidas e Revenda', 'Despesa', 'cmv', 7),
                ('Aluguel e Condomínio', 'Despesa', 'despesas_operacionais', 8),
                ('Energia Elétrica', 'Despesa', 'despesas_operacionais', 9),
                ('Entregadores / Motoboy', 'Despesa', 'despesas_vendas', 10),
                ('Marketing e Anúncios', 'Despesa', 'despesas_vendas', 11),
                ('Tarifas Bancárias', 'Despesa', 'despesas_financeiras', 12)
            `);
        }
        const lista = await pool.query('SELECT * FROM fin_categorias ORDER BY ordem ASC, id ASC');
        res.json(lista.rows);
    } catch (e) {
        console.error("ErroCategorias:", e);
        res.status(500).json({ erro: "Erro ao buscar categorias" });
    }
});

// 5.1 Criar Nova Categoria Personalizada
app.post('/api/financeiro/categorias', async (req, res) => {
    try {
        const { nome, tipo, dre_ref } = req.body;
        if (!nome || !tipo || !dre_ref) return res.status(400).json({ erro: "Dados incompletos" });

        // 🛡️ VACINAS ANTI-ERRO 500: Remove o limite de 100 caracteres do nome e garante a coluna de ordem!
        await pool.query("ALTER TABLE fin_categorias ALTER COLUMN nome TYPE TEXT");
        await pool.query("ALTER TABLE fin_categorias ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 0");

        const maxOrdem = await pool.query("SELECT COALESCE(MAX(ordem), 0) + 1 as proximo FROM fin_categorias");
        const proximaOrdem = maxOrdem.rows[0].proximo;

        await pool.query(
            "INSERT INTO fin_categorias (nome, tipo, dre_ref, ordem) VALUES ($1, $2, $3, $4)",
            [nome, tipo, dre_ref, proximaOrdem]
        );
        res.status(201).json({ sucesso: true });
    } catch (e) {
        console.error("Erro interno ao criar categoria:", e); 
        res.status(500).json({ erro: "Erro ao criar categoria" });
    }
});

// 5.2 Salvar Reordenação de Categorias (Bulk Update Drag and Drop)
app.put('/api/financeiro/categorias/ordem', async (req, res) => {
    try {
        // 🛡️ VACINA ANTI-ERRO 500: Garante a coluna antes de arrastar e soltar
        await pool.query("ALTER TABLE fin_categorias ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 0");

        for (let cat of req.body) {
            await pool.query('UPDATE fin_categorias SET ordem = $1 WHERE id = $2', [cat.ordem, cat.id]);
        }
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro interno ao reordenar:", e);
        res.status(500).json({ erro: "Erro ao reordenar" });
    }
});

// 5.3 Deletar Categoria do Plano de Contas
app.delete('/api/financeiro/categorias/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM fin_categorias WHERE id = $1', [req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao deletar categoria. Verifique se existem lançamentos usando ela." });
    }
});

// 5.4 Atualizar/Editar Nome da Categoria do Plano de Contas
app.put('/api/financeiro/categorias/:id', async (req, res) => {
    try {
        const { nome } = req.body;
        if (!nome) return res.status(400).json({ erro: "O nome é obrigatório" });

        // 🛡️ VACINA ANTI-ERRO 500: Garante que edições (Lápis) também aceitem textos infinitos
        await pool.query("ALTER TABLE fin_categorias ALTER COLUMN nome TYPE TEXT");

        await pool.query('UPDATE fin_categorias SET nome = $1 WHERE id = $2', [nome, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao editar categoria:", e);
        res.status(500).json({ erro: "Erro ao editar categoria." });
    }
});

// 5.5 Ativar/Inativar Categoria do Plano de Contas
app.put('/api/financeiro/categorias/:id/status', async (req, res) => {
    try {
        await pool.query('UPDATE fin_categorias SET ativa = $1 WHERE id = $2', [req.body.ativa, req.params.id]);
        res.json({ sucesso: true });
    } catch (e) {
        console.error("Erro ao alterar status da categoria:", e);
        res.status(500).json({ erro: "Erro ao inativar categoria." });
    }
});

// 6. Relatório DRE Automatizado (Cruzando lançamentos manuais + vendas do PDV)
app.get('/api/financeiro/dre', async (req, res) => {
    try {
        const { visao } = req.query; // 👇 CAPTURA A CHAVE DO FRONTEND (efetuado ou previsto)
        let filtroStatus = visao === 'efetuado' ? " AND l.status = 'Pago'" : "";

        // 👇 CORREÇÃO FUSO HORÁRIO E FILTRO DE STATUS
        const query = `
            SELECT c.dre_ref, COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
            ${filtroStatus}
            GROUP BY c.dre_ref
        `;
        const resultado = await pool.query(query);
        
        const vendasMesQuery = await pool.query(`
            SELECT COALESCE(SUM(valor_total), 0) as total, COALESCE(SUM(custo_real), 0) as custo_consumido 
            FROM vendas 
            WHERE status NOT ILIKE '%cancelad%'
            AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
            AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
        `);
        const faturamentoAutomaticoMes = parseFloat(vendasMesQuery.rows[0].total);
        const cmvConsumidoMes = parseFloat(vendasMesQuery.rows[0].custo_consumido);

        const dre = {
            receita_bruta: 0, deducoes: 0, cmv: 0, 
            despesas_vendas: 0, despesas_operacionais: 0, 
            investimentos: 0, despesas_financeiras: 0, 
            distribuicao_lucros: 0, outras_receitas: 0, nao_operacional: 0,
            aporte_capital: 0,
            detalhes: {}
        };

        resultado.rows.forEach(row => {
            if (dre[row.dre_ref] !== undefined) dre[row.dre_ref] = parseFloat(row.total);
        });

        // 👇 APLICA O FILTRO TAMBÉM NA VISÃO DETALHADA
        const queryDetalhes = `
            SELECT c.dre_ref, c.nome, COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
            ${filtroStatus}
            GROUP BY c.dre_ref, c.nome
        `;
        const resDetalhes = await pool.query(queryDetalhes);
        resDetalhes.rows.forEach(r => {
            if (!dre.detalhes[r.dre_ref]) dre.detalhes[r.dre_ref] = [];
            dre.detalhes[r.dre_ref].push({ nome: r.nome, total: parseFloat(r.total) });
        });

        if (!dre.detalhes['receita_bruta']) dre.detalhes['receita_bruta'] = [];
        if (faturamentoAutomaticoMes > 0) {
            dre.detalhes['receita_bruta'].push({ nome: 'Faturamento de Vendas (PDV/Delivery)', total: faturamentoAutomaticoMes });
        }

        dre.cmv_financeiro = dre.cmv; // Guarda silenciosamente o que saiu da conta bancária
        dre.cmv = cmvConsumidoMes; // 🚀 Substitui o CMV do DRE pelo custo real da Ficha Técnica
        dre.detalhes['cmv'] = [ { nome: 'Custo das Fichas Técnicas (Insumos Consumidos)', total: cmvConsumidoMes } ];

        dre.receita_bruta = dre.receita_bruta + faturamentoAutomaticoMes;
        dre.outras_receitas = dre.outras_receitas + dre.aporte_capital;

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
app.get('/api/financeiro/graficos', verificarToken, async (req, res) => {
    try {
        // 1. Receitas vs Despesas (Mês Atual) - IGNORANDO TRANSFERÊNCIAS (movimentacao_interna) E PEGANDO SÓ O PAGO
        const despesasQuery = await pool.query(`
            SELECT COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Despesa' AND l.status = 'Pago'
            AND c.dre_ref != 'movimentacao_interna' 
            AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);
        
        const receitasQuery = await pool.query(`
            SELECT COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Receita' AND l.status = 'Pago'
            AND c.dre_ref != 'movimentacao_interna' 
            AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);
        
        const vendasQuery = await pool.query(`
            SELECT COALESCE(SUM(valor_total), 0) as total 
            FROM vendas 
            WHERE status NOT ILIKE '%cancelad%' 
            AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);

        // Total de Receitas limpo (sem dupla contagem do fechamento de caixa que gera "movimentacao_interna")
        const totalReceitas = parseFloat(receitasQuery.rows[0].total) + parseFloat(vendasQuery.rows[0].total);
        const totalDespesas = parseFloat(despesasQuery.rows[0].total);

        // 2. Onde o dinheiro está indo? (Ignorando transferências e fechamentos)
        const despesasPorCategoria = await pool.query(`
            SELECT c.nome, SUM(l.valor) as total
            FROM fin_lancamentos l
            JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.tipo = 'Despesa' AND l.status = 'Pago'
            AND c.dre_ref != 'movimentacao_interna'
            AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY c.nome
            ORDER BY total DESC
        `);

        // 3. Canais de Venda
        const canaisQuery = await pool.query(`
            SELECT origem, SUM(valor_total) as total
            FROM vendas
            WHERE status NOT ILIKE '%cancelad%' 
            AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY origem
            ORDER BY total DESC
        `);

        // 4. Inteligência do Ponto de Equilíbrio
        const dreQuery = await pool.query(`
            SELECT c.dre_ref, COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE l.status = 'Pago'
            AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY c.dre_ref
        `);
        const dre = { deducoes: 0, cmv: 0, despesas_vendas: 0, despesas_operacionais: 0, despesas_financeiras: 0 };
        dreQuery.rows.forEach(r => { if(dre[r.dre_ref] !== undefined) dre[r.dre_ref] = parseFloat(r.total); });
        
        const custosVariaveis = dre.deducoes + dre.cmv + dre.despesas_vendas;
        const custosFixos = dre.despesas_operacionais + dre.despesas_financeiras;
        
        // Evita divisão por zero se não tiver receita ainda
        let margemContribuicao = totalReceitas > 0 ? ((totalReceitas - custosVariaveis) / totalReceitas) : 0.3; 
        if (margemContribuicao <= 0) margemContribuicao = 0.01;
        
        let pontoEquilibrio = custosFixos / margemContribuicao;
        if (pontoEquilibrio === 0) pontoEquilibrio = 1000; // Valor apenas para formar o visual inicial
        
        const metaReceita = pontoEquilibrio * 1.30; // Sugere meta de lucro 30% acima da sobrevivência

        res.json({
            resumo_mes: { receitas: totalReceitas, despesas: totalDespesas },
            despesas_pizza: despesasPorCategoria.rows,
            canais_venda: canaisQuery.rows,
            ponto_equilibrio: { pe: pontoEquilibrio, meta: metaReceita, atual: totalReceitas }
        });
    } catch (e) {
        console.error("Erro nos gráficos:", e);
        res.status(500).json({ erro: "Erro ao carregar dados dos gráficos" });
    }
});

// ==========================================
// 11. Relatório de Fluxo de Caixa (Regime de Caixa com Carry Over)
// ==========================================
app.get('/api/financeiro/fluxo-caixa', verificarToken, async (req, res) => {
    try {
        // 1. Gera o esqueleto de 12 meses: 5 meses passados + Mês Atual + 6 meses no futuro
        const meses = [];
        let dataInicioJanela = null;
        
        for (let i = -5; i <= 6; i++) {
            const d = new Date();
            // 🛡️ VACINA ANTI-PULO: Trava no dia 1 para não bugar em meses de 31 dias
            d.setDate(1); 
            d.setMonth(d.getMonth() + i);
            const ano = d.getFullYear();
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            meses.push(`${ano}-${mes}`);
            if (i === -5) dataInicioJanela = `${ano}-${mes}-01`;
        }

        // 2. 🧠 A MÁGICA DO CARRY OVER: Calcula TUDO que a empresa faturou e gastou ANTES da nossa tabela começar
        const bancosQuery = await pool.query("SELECT COALESCE(SUM(saldo_inicial), 0) as total FROM fin_contas_bancarias");
        const saldoBancosOrigem = parseFloat(bancosQuery.rows[0].total);

        const vendasPassadoQuery = await pool.query(`
            SELECT COALESCE(SUM(valor_total), 0) as total FROM vendas 
            WHERE status NOT ILIKE '%cancelad%' AND data_hora < $1
        `, [dataInicioJanela]);
        
        const lancamentosPassadoQuery = await pool.query(`
            SELECT tipo, COALESCE(SUM(valor), 0) as total FROM fin_lancamentos 
            WHERE data_vencimento < $1 AND status = 'Pago' 
            AND categoria_id IN (SELECT id FROM fin_categorias WHERE dre_ref != 'movimentacao_interna')
            GROUP BY tipo
        `, [dataInicioJanela]);

        let receitasPassado = parseFloat(vendasPassadoQuery.rows[0].total);
        let despesasPassado = 0;
        lancamentosPassadoQuery.rows.forEach(r => {
            if (r.tipo === 'Receita') receitasPassado += parseFloat(r.total);
            if (r.tipo === 'Despesa') despesasPassado += parseFloat(r.total);
        });

        // Montante exato da empresa no primeiro dia do nosso Dashboard
        let saldoAcumulado = saldoBancosOrigem + receitasPassado - despesasPassado; 

        // 3. Busca os dados apenas da janela de 12 meses
        const vendasQuery = await pool.query(`
            SELECT TO_CHAR(data_hora, 'YYYY-MM') as mes, COALESCE(SUM(valor_total), 0) as total
            FROM vendas WHERE status NOT ILIKE '%cancelad%' AND data_hora >= $1 GROUP BY mes
        `, [dataInicioJanela]);

        const lancamentosQuery = await pool.query(`
            SELECT TO_CHAR(l.data_vencimento, 'YYYY-MM') as mes, c.dre_ref, c.nome, c.tipo, l.status, COALESCE(SUM(l.valor), 0) as total
            FROM fin_lancamentos l JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE c.dre_ref != 'movimentacao_interna' AND l.data_vencimento >= $1
            GROUP BY mes, c.dre_ref, c.nome, c.tipo, l.status
        `, [dataInicioJanela]);

        const dataAtual = new Date();
        const mesAtualStr = `${dataAtual.getFullYear()}-${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;

        // 4. Monta a escadinha e rola o saldo
        const fluxoCaixa = [];
        for (let mes of meses) {
            const vendasMes = parseFloat(vendasQuery.rows.find(v => v.mes === mes)?.total || 0);
            const lancamentosMes = lancamentosQuery.rows.filter(l => l.mes === mes);
            
            let receitas_manuais = 0;
            let cmv = 0, desp_op = 0, desp_vendas = 0, impostos = 0, financeiras = 0, investimentos = 0;
            let detalhes = { receitas_manuais: {}, cmv: {}, despesas_operacionais: {}, despesas_vendas: {}, deducoes: {}, financeiras_invest: {} };

            lancamentosMes.forEach(l => {
                // EXIGE liquidação (Pago) se o mês já passou. Permite projeção se for atual/futuro.
                if (mes < mesAtualStr && l.status !== 'Pago') return;

                const valor = parseFloat(l.total);
                if (l.tipo === 'Receita') {
                    receitas_manuais += valor;
                    detalhes.receitas_manuais[l.nome] = (detalhes.receitas_manuais[l.nome] || 0) + valor;
                } else if (l.tipo === 'Despesa') {
                    if (l.dre_ref === 'cmv') { cmv += valor; detalhes.cmv[l.nome] = (detalhes.cmv[l.nome] || 0) + valor; }
                    else if (l.dre_ref === 'despesas_operacionais') { desp_op += valor; detalhes.despesas_operacionais[l.nome] = (detalhes.despesas_operacionais[l.nome] || 0) + valor; }
                    else if (l.dre_ref === 'despesas_vendas') { desp_vendas += valor; detalhes.despesas_vendas[l.nome] = (detalhes.despesas_vendas[l.nome] || 0) + valor; }
                    else if (l.dre_ref === 'deducoes') { impostos += valor; detalhes.deducoes[l.nome] = (detalhes.deducoes[l.nome] || 0) + valor; }
                    else { financeiras += valor; detalhes.financeiras_invest[l.nome] = (detalhes.financeiras_invest[l.nome] || 0) + valor; }
                }
            });

            const formatDetails = (obj) => Object.keys(obj).map(k => ({ nome: k, total: obj[k] }));

            const receita_total = vendasMes + receitas_manuais;
            const despesa_total = cmv + desp_op + desp_vendas + impostos + financeiras + investimentos;
            
            // 👇 EXECUTA A ROLAGEM MÊS A MÊS
            const saldo_inicial_mes = saldoAcumulado;
            const geracao_caixa = receita_total - despesa_total; // O que sobrou SÓ no mês
            saldoAcumulado += geracao_caixa; // Soma à conta bancária e empurra pro próximo mês
            const saldo_final_mes = saldoAcumulado;

            fluxoCaixa.push({
                mes,
                saldo_inicial: saldo_inicial_mes,
                receita_vendas: vendasMes,
                receitas_manuais,
                receita_total,
                cmv, desp_op, desp_vendas, impostos, financeiras, investimentos,
                despesa_total,
                saldo_mes: geracao_caixa, // Antigo "Sobra"
                saldo_final: saldo_final_mes,
                detalhes: {
                    receitas_manuais: formatDetails(detalhes.receitas_manuais),
                    cmv: formatDetails(detalhes.cmv),
                    despesas_operacionais: formatDetails(detalhes.despesas_operacionais),
                    despesas_vendas: formatDetails(detalhes.despesas_vendas),
                    deducoes: formatDetails(detalhes.deducoes),
                    financeiras_invest: formatDetails(detalhes.financeiras_invest)
                }
            });
        }

        res.json(fluxoCaixa);
    } catch (e) {
        console.error("Erro no Fluxo de Caixa:", e);
        res.status(500).json({ erro: "Erro ao gerar fluxo de caixa" });
    }
});

// ==========================================
// 12. Executar Transferência entre Contas com Dedução de Taxas (Auditoria)
// ==========================================
app.post('/api/financeiro/transferencias', async (req, res) => {
    let client; // 🛡️ Criamos a variável do 'funcionário exclusivo'
    try {
        const { conta_origem_id, conta_destino_id, valor_bruto, taxa, descricao, data_transferencia } = req.body;
        
        const vBruto = parseFloat(valor_bruto);
        const vTaxa = parseFloat(taxa) || 0;
        const vLiquido = vBruto - vTaxa;
        
        // 🛡️ Tratamento de segurança: se vier vazio do frontend, vira null para não quebrar o banco
        const contaOrigem = conta_origem_id ? parseInt(conta_origem_id) : null;
        const contaDestino = conta_destino_id ? parseInt(conta_destino_id) : null;
        
        const dataAtual = data_transferencia || new Date().toISOString().split('T')[0];

        let catResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'movimentacao_interna' LIMIT 1");
        if (catResult.rows.length === 0) {
            catResult = await pool.query("INSERT INTO fin_categorias (nome, tipo, dre_ref) VALUES ('Transferência / Fechamento', 'Receita', 'movimentacao_interna') RETURNING id");
        }
        const categoriaInternaId = catResult.rows[0].id;

        // 👇 NOVO: O Auditor agora procura especificamente pela subconta de Taxas/Maquininha
        let catTaxaResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'deducoes' AND (nome ILIKE '%Maquininha%' OR nome ILIKE '%Cartão%' OR nome ILIKE '%Cartao%') LIMIT 1");
        
        // Plano B: Se a conta não for encontrada (nome alterado), ele pega a primeira disponível para não quebrar a transação
        if (catTaxaResult.rows.length === 0) {
            catTaxaResult = await pool.query("SELECT id FROM fin_categorias WHERE dre_ref = 'deducoes' LIMIT 1");
        }
        
        const categoriaTaxaId = catTaxaResult.rows[0]?.id || null;

        // 🚀 A MÁGICA ACONTECE AQUI: Pegamos uma conexão exclusiva
        client = await pool.connect();
        await client.query('BEGIN');

        await client.query(`
            INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
            VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)
        `, [`[Saída Transferência] ${descricao}`, vBruto, dataAtual, categoriaInternaId, contaOrigem]);

        await client.query(`
            INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
            VALUES ($1, $2, $3, 'Pago', 'Receita', $4, $5)
        `, [`[Entrada Transferência] ${descricao}`, vLiquido, dataAtual, categoriaInternaId, contaDestino]);

        if (vTaxa > 0 && categoriaTaxaId) {
            await client.query(`
                INSERT INTO fin_lancamentos (descricao, valor, data_vencimento, status, tipo, categoria_id, conta_id)
                VALUES ($1, $2, $3, 'Pago', 'Despesa', $4, $5)
            `, [`[Taxa Maquininha] ${descricao}`, vTaxa, dataAtual, categoriaTaxaId, contaOrigem]);
        }

        await client.query('COMMIT');
        res.json({ sucesso: true });
    } catch (e) {
        // Se der erro, cancelamos apenas as ações desse funcionário
        if (client) await client.query('ROLLBACK');
        console.error("Erro na transferência:", e);
        res.status(500).json({ erro: "Erro ao processar transferência" });
    } finally {
        // Sempre devolvemos o funcionário para o grupo (pool) ao terminar
        if (client) client.release();
    }
});

// ==========================================
// 13. CENTRAL DE ALERTAS INTELIGENTES (CFO VIRTUAL)
// ==========================================
app.get('/api/financeiro/alertas', async (req, res) => {
    try {
        // 1. Dados do DRE (Mês Atual)
        const queryDRE = `
            SELECT c.dre_ref, COALESCE(SUM(l.valor), 0) as total 
            FROM fin_lancamentos l JOIN fin_categorias c ON l.categoria_id = c.id
            WHERE EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) 
            AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)
            AND l.status = 'Pago'
            GROUP BY c.dre_ref
        `;
        const resDRE = await pool.query(queryDRE);
        const dre = { cmv: 0, despesas_operacionais: 0, despesas_financeiras: 0, deducoes: 0, despesas_vendas: 0 };
        resDRE.rows.forEach(r => { if(dre[r.dre_ref] !== undefined) dre[r.dre_ref] = parseFloat(r.total); });
        
        // 2. Faturamento Bruto, Ticket Médio e Custo Real
        const vendasMes = await pool.query("SELECT COALESCE(SUM(valor_total), 0) as total, COALESCE(SUM(custo_real), 0) as custo_consumido, COUNT(*) as qtd FROM vendas WHERE status NOT ILIKE '%cancelad%' AND EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)");
        const faturamentoPDV = parseFloat(vendasMes.rows[0].total);
        const cmvConsumido = parseFloat(vendasMes.rows[0].custo_consumido);
        const qtdPedidos = parseInt(vendasMes.rows[0].qtd) || 1;
        
        const receitasManuais = await pool.query("SELECT COALESCE(SUM(l.valor), 0) as total FROM fin_lancamentos l JOIN fin_categorias c ON l.categoria_id = c.id WHERE l.tipo = 'Receita' AND l.status = 'Pago' AND c.dre_ref != 'movimentacao_interna' AND EXTRACT(MONTH FROM l.data_vencimento) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM l.data_vencimento) = EXTRACT(YEAR FROM CURRENT_DATE)");
        const faturamentoTotal = faturamentoPDV + parseFloat(receitasManuais.rows[0].total);
        const ticketMedio = faturamentoTotal / qtdPedidos;

        // 3. Saldo em Bancos (Excluindo Caixa Físico/Gaveta)
        const bancos = await pool.query(`
            SELECT b.saldo_inicial,
            COALESCE((SELECT SUM(valor) FROM fin_lancamentos WHERE conta_id = b.id AND tipo = 'Receita' AND status = 'Pago'), 0) as entradas,
            COALESCE((SELECT SUM(valor) FROM fin_lancamentos WHERE conta_id = b.id AND tipo = 'Despesa' AND status = 'Pago'), 0) as saidas
            FROM fin_contas_bancarias b
            WHERE b.nome NOT ILIKE '%Caixa Físico%' AND b.nome NOT ILIKE '%Gaveta%'
        `);
        let saldoCaixa = 0;
        bancos.rows.forEach(b => saldoCaixa += parseFloat(b.saldo_inicial) + parseFloat(b.entradas) - parseFloat(b.saidas));

        // 4. Montagem dos Alertas
        const alertas = [];
        
        // A) Termômetro do CMV e Desperdício
        const cmvFinanceiro = dre.cmv; // O que foi pago a fornecedores
        const diferencaEstoque = cmvFinanceiro - cmvConsumido;
        let pctCMVReal = faturamentoTotal > 0 ? (cmvConsumido / faturamentoTotal) * 100 : 0;
        
        if (pctCMVReal > 35) {
            alertas.push({ tipo: 'perigo', icone: 'soup_kitchen', titulo: `Custo da Receita Elevado (${pctCMVReal.toFixed(1)}%)`, texto: 'Sua Ficha Técnica está cara! O ideal é abaixo de 35%. Reveja as porções de açaí e adicionais ou aumente os preços.' });
        } else if (pctCMVReal > 0) {
            alertas.push({ tipo: 'sucesso', icone: 'verified', titulo: `Ficha Técnica Saudável (${pctCMVReal.toFixed(1)}%)`, texto: 'As porções dos produtos vendidos estão com a margem de lucro perfeita.' });
        }

        if (diferencaEstoque > (faturamentoTotal * 0.05)) { // Mais de 5% de diferença
            alertas.push({ tipo: 'alerta', icone: 'inventory', titulo: `Estoque Parado ou Perda (R$ ${diferencaEstoque.toFixed(2).replace('.', ',')})`, texto: 'Você pagou muito mais aos fornecedores do que as vendas consumiram. Verifique se há muita mercadoria estocada nas geladeiras ou desperdício na montagem.' });
        }

        // B) Radar de Custos Fixos
        const custosFixos = dre.despesas_operacionais + dre.despesas_financeiras;
        let pctFixos = faturamentoTotal > 0 ? (custosFixos / faturamentoTotal) * 100 : 0;
        if (pctFixos > 30 && faturamentoTotal > 0) {
            alertas.push({ tipo: 'alerta', icone: 'domain', titulo: `Custos Fixos Altos (${pctFixos.toFixed(1)}%)`, texto: 'O custo para manter as portas abertas está engolindo sua margem. O ideal é abaixo de 25%. Aumente o volume de vendas!' });
        } else if (pctFixos > 0) {
            alertas.push({ tipo: 'sucesso', icone: 'domain_verification', titulo: 'Custos Fixos Controlados', texto: 'Sua estrutura está enxuta e adequada para o seu volume de vendas mensal.' });
        }

        // C) Fôlego de Caixa (Capital de Giro)
        if (custosFixos > 0) {
            const mesesFolego = saldoCaixa / custosFixos;
            const diasFolego = Math.max(0, Math.round(mesesFolego * 30));
            if (diasFolego < 30) {
                alertas.push({ tipo: 'perigo', icone: 'warning', titulo: `Fôlego Crítico (${diasFolego} dias)`, texto: 'Com o saldo nos bancos, a empresa sobrevive menos de 1 mês. Segure gastos não essenciais imediatamente!' });
            } else if (diasFolego < 90) {
                alertas.push({ tipo: 'alerta', icone: 'health_and_safety', titulo: `Fôlego de Caixa (${diasFolego} dias)`, texto: 'Você tem caixa para cobrir de 1 a 3 meses. Continue poupando sua reserva de segurança.' });
            } else {
                alertas.push({ tipo: 'sucesso', icone: 'account_balance', titulo: `Fôlego Seguro (${diasFolego} dias)`, texto: 'Caixa blindado! Você sobrevive mais de 3 meses mesmo se não faturar nada.' });
            }
        }

        // D) Acelerador de Ticket Médio vs Ponto de Equilíbrio
        const custosVariaveis = dre.deducoes + dre.cmv + dre.despesas_vendas;
        let margemContribuicao = faturamentoTotal > 0 ? ((faturamentoTotal - custosVariaveis) / faturamentoTotal) : 0.3;
        if (margemContribuicao <= 0) margemContribuicao = 0.01;
        const pontoEquilibrio = custosFixos / margemContribuicao;

        if (faturamentoTotal < pontoEquilibrio) {
            const falta = pontoEquilibrio - faturamentoTotal;
            const tk = ticketMedio > 0 ? ticketMedio : 25;
            const clientesFaltam = Math.ceil(falta / tk);
            alertas.push({ tipo: 'dica', icone: 'rocket_launch', titulo: 'Meta de Empate Operacional', texto: `Faltam R$ ${falta.toFixed(2).replace('.', ',')} para pagar as contas do mês. Precisamos de ${clientesFaltam} clientes gastando R$ ${tk.toFixed(2).replace('.', ',')}. Ofereça adicionais!` });
        } else {
             alertas.push({ tipo: 'sucesso', icone: 'moving', titulo: 'Ponto de Equilíbrio Superado', texto: 'Todas as contas fixas do mês já estão pagas. Tudo que vender a partir de agora gera lucro limpo no caixa!' });
        }

        res.json(alertas);
    } catch (e) {
        console.error("Erro nos alertas:", e);
        res.status(500).json({ erro: "Erro ao gerar alertas" });
    }
});

// ==========================================
// 🎯 MÓDULO DE MARKETING & DISPAROS INTELIGENTES
// ==========================================

// 1. Salvar o registro de um disparo feito para não repetir depois
app.post('/api/marketing/registro', async (req, res) => {
    try {
        const { telefone, nome, campanha } = req.body;
        const telLimpo = String(telefone).replace(/\D/g, '');
        await pool.query(
            "INSERT INTO marketing_envios (telefone, cliente_nome, campanha) VALUES ($1, $2, $3)", 
            [telLimpo, nome, campanha]
        );
        res.status(201).json({ sucesso: true });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao registrar disparo" });
    }
});

// 2. Rastrear o Lucro (ROI) e o Histórico de Disparos
app.get('/api/marketing/dashboard', async (req, res) => {
    try {
        // A) Pega todos os envios feitos e o tempo passado
        const enviosQuery = await pool.query("SELECT * FROM marketing_envios ORDER BY data_envio DESC");
        const envios = enviosQuery.rows;

        // B) Cruzamento Inteligente: Calcula as vendas feitas em até 48h APÓS o cliente receber a mensagem
        const roiQuery = await pool.query(`
            SELECT SUM(v.valor_total) as lucro_gerado, COUNT(v.id) as pedidos_gerados
            FROM vendas v
            JOIN marketing_envios m ON regexp_replace(v.cliente_telefone, '\\D', '', 'g') = m.telefone
            WHERE v.data_hora > m.data_envio 
            AND v.data_hora <= (m.data_envio + INTERVAL '48 hours')
            AND v.status NOT ILIKE '%cancelad%'
        `);

        res.json({
            historico: envios,
            kpis: {
                total_enviado: envios.length,
                pedidos_gerados: parseInt(roiQuery.rows[0].pedidos_gerados) || 0,
                lucro_gerado: parseFloat(roiQuery.rows[0].lucro_gerado) || 0
            }
        });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao calcular ROI do marketing" });
    }
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => console.log(`🚀 Servidor Icesoft v5.0 (com WebSockets) na porta ${PORTA}!`));
