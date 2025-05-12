require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');


const app = express();
const port = process.env.PORT || 3000;

// Функция для форматирования даты
function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('ru-RU');
  }

console.log('Подключаемся к БД:', {
    user: process.env.DB_USER || 'matvey',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'my_database',
    port: process.env.DB_PORT || 5432
  });
  
// Настройка подключения к PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'matvey',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'my_database',
  password: process.env.DB_PASSWORD || 'Doctormatvey',
  port: process.env.DB_PORT || 5432,
});

// Проверка подключения к БД
pool.connect((err, client, release) => {
  if (err) {
    console.error('Ошибка подключения к PostgreSQL:', err);
    process.exit(1);
  }
  console.log('Успешное подключение к PostgreSQL');
  release();
});

// Настройка шаблонизатора EJS
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Проверка структуры БД
async function checkDatabaseStructure() {
  const client = await pool.connect();
  try {
    console.log("Проверка существования таблиц...");
    
    const tablesToCheck = [
      'equipment', 'staff', 'spare_parts', 
      'maintenance', 'locations', 'models',
      'maintenance_spare_parts', 'failures',

  ];
    
    for (const table of tablesToCheck) {
      const res = await client.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables 
           WHERE table_schema = 'public' AND table_name = $1
        )`, [table]);
      
      console.log(`Таблица ${table}: ${res.rows[0].exists ? 'существует' : 'ОТСУТСТВУЕТ'}`);
    }
  } catch (err) {
    console.error('Ошибка проверки структуры БД:', err);
  } finally {
    client.release();
  }
}

app.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT e.id, e.name, m.name as model, l.name as location, 
               e.quantity, e.description
        FROM equipment e
        LEFT JOIN models m ON e.model_id = m.id
        LEFT JOIN locations l ON e.location_id = l.id
      `);
      res.render('equipment/list', { 
        equipment: rows,
        currentPage: 'equipment' // Добавлено
      });
    } catch (err) {
      console.error('Ошибка при получении оборудования:', err);
      res.status(500).render('error', { 
        message: 'Ошибка загрузки данных',
        currentPage: 'equipment'
      });
    }
  });


  app.get('/equipment/add', async (req, res) => {
    try {
      const models = await pool.query('SELECT * FROM models');
      const locations = await pool.query('SELECT * FROM locations');
      res.render('equipment/add', { 
        models: models.rows,
        locations: locations.rows,
        currentPage: 'add-equipment' // Добавлено
      });
    } catch (err) {
      console.error(err);
      res.status(500).render('error', { 
        message: 'Ошибка загрузки формы',
        currentPage: 'add-equipment'
      });
    }
  });

  app.post('/equipment/add', async (req, res) => {
    const { name, model_id, new_model, quantity, location_id, description } = req.body;
    
    try {
      let finalModelId = model_id;
      
      // Если выбрано "Добавить новую модель"
      if (model_id === 'new' && new_model) {
        const newModel = await pool.query(
          'INSERT INTO models (name) VALUES ($1) RETURNING id',
          [new_model]
        );
        finalModelId = newModel.rows[0].id;
      }
      
      await pool.query(
        'INSERT INTO equipment (name, model_id, quantity, location_id, description) VALUES ($1, $2, $3, $4, $5)',
        [name, finalModelId || null, quantity, location_id || null, description]
      );
      res.redirect('/');
    } catch (err) {
      console.error(err);
      
      // Получаем данные для повторного отображения формы
      const [models, locations] = await Promise.all([
        pool.query('SELECT * FROM models'),
        pool.query('SELECT * FROM locations')
      ]);
      
      res.render('equipment/add', {
        models: models.rows,
        locations: locations.rows,
        error: 'Ошибка добавления оборудования',
        formData: req.body
      });
    }
  });

app.get('/equipment/edit/:id', async (req, res) => {
  try {
    const equipment = await pool.query('SELECT * FROM equipment WHERE id = $1', [req.params.id]);
    const models = await pool.query('SELECT * FROM models');
    const locations = await pool.query('SELECT * FROM locations');
    
    if (equipment.rows.length === 0) {
      return res.status(404).render('error', { message: 'Оборудование не найдено' });
    }
    
    res.render('equipment/edit', { 
      item: equipment.rows[0],
      models: models.rows,
      locations: locations.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки формы' });
  }
});
app.post('/equipment/edit/:id', async (req, res) => {
  const { id } = req.params;
  const { name, model_id, new_model, quantity, location_id, description } = req.body;

  try {
    let finalModelId = model_id;
    
    if (model_id === 'new' && new_model) {
      const newModel = await pool.query(
        'INSERT INTO models (name) VALUES ($1) RETURNING id',
        [new_model]
      );
      finalModelId = newModel.rows[0].id;
    }

    await pool.query(
      'UPDATE equipment SET name = $1, model_id = $2, quantity = $3, location_id = $4, description = $5 WHERE id = $6',
      [name, finalModelId || null, quantity, location_id || null, description, id]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Ошибка при обновлении:', err);
    
    // Получаем данные для повторного отображения формы
    try {
      const [equipment, models, locations] = await Promise.all([
        pool.query('SELECT * FROM equipment WHERE id = $1', [id]),
        pool.query('SELECT * FROM models'),
        pool.query('SELECT * FROM locations')
      ]);
      
      res.render('equipment/edit', {
        item: equipment.rows[0],
        models: models.rows,
        locations: locations.rows,
        error: `Ошибка обновления: ${err.message}`,
        formData: req.body
      });
    } catch (fetchErr) {
      console.error('Ошибка при получении данных:', fetchErr);
      res.status(500).render('error', { message: 'Ошибка обработки запроса' });
    }
  }
});
app.post('/equipment/delete/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Проверяем существование оборудования
    const checkResult = await pool.query('SELECT id FROM equipment WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).render('error', {
        message: 'Оборудование не найдено',
        currentPage: 'equipment'
      });
    }

    // Удаляем оборудование
    await pool.query('DELETE FROM equipment WHERE id = $1', [id]);
    res.redirect('/');
  } catch (err) {
    console.error('Ошибка при удалении оборудования:', {
      error: err,
      stack: err.stack,
      id: id
    });

 
    if (err.code === '23503') { 
      return res.status(400).render('error', {
        message: 'Нельзя удалить оборудование, так как оно связано с другими записями (ТО, ремонты и т.д.)',
        currentPage: 'equipment'
      });
    }

    res.status(500).render('error', {
      message: 'Ошибка удаления оборудования',
      currentPage: 'equipment'
    });
  }
});

app.post('/staff/delete/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM staff WHERE id = $1', [req.params.id]);
    res.redirect('/staff');
  } catch (err) {
    console.error('Ошибка при удалении сотрудника:', err);
    res.status(500).render('error', { 
      message: 'Ошибка удаления сотрудника',
      currentPage: 'staff'
    });
  }
});

app.post('/staff/edit/:id', async (req, res) => {
  const { full_name, position } = req.body;
  const id = req.params.id;

  if (!full_name || !position) {
    try {
      const staff = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
      return res.render('staff/edit', { 
        staff: staff.rows[0],
        error: 'ФИО и должность обязательны для заполнения'
      });
    } catch (err) {
      return res.status(400).redirect('/staff');
    }
  }

  try {
    await pool.query(
      'UPDATE staff SET full_name = $1, position = $2 WHERE id = $3',
      [full_name, position, id]
    );
    res.redirect('/staff');
  } catch (err) {
    console.error('Ошибка при обновлении сотрудника:', err);
    
    try {
      const staff = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
      res.render('staff/edit', { 
        staff: staff.rows[0],
        error: 'Ошибка обновления сотрудника'
      });
    } catch (fetchErr) {
      res.status(500).redirect('/staff');
    }
  }
});

// Диагностические маршруты
app.get('/db-info', async (req, res) => {
  try {
    const dbInfo = await pool.query(
      'SELECT current_database(), current_user, version()'
    );
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    res.json({
      database: dbInfo.rows[0],
      tables: tables.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
      message: 'Внутренняя ошибка сервера',
      currentPage: ''
    });
  });





async function createTables() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS models (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS locations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) UNIQUE NOT NULL
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(255) NOT NULL,
          position VARCHAR(255) NOT NULL
        )
      `);
      
      // Таблица оборудования
      await client.query(`
        CREATE TABLE IF NOT EXISTS equipment (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          model_id INTEGER REFERENCES models(id),
          quantity INTEGER DEFAULT 1,
          location_id INTEGER REFERENCES locations(id),
          description TEXT
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance (
          id SERIAL PRIMARY KEY,
          equipment_id INT NOT NULL REFERENCES equipment(id),
          model_id INT REFERENCES models(id),
          date DATE NOT NULL,
          maintenance_type VARCHAR(255) NOT NULL,
          work_description TEXT NOT NULL,
          spare_parts TEXT,
          decision VARCHAR(255),
          performed_by VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          reminder_date DATE
        )
      `);
      //в будущем 
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_logs (
          id SERIAL PRIMARY KEY,
          maintenance_id INT REFERENCES maintenance(id) ON DELETE CASCADE,
          changed_by INT REFERENCES staff(id),
          change_date TIMESTAMP DEFAULT NOW(),
          action_type VARCHAR(20) CHECK (action_type IN ('create', 'update', 'delete')),
          old_values JSONB,
          new_values JSONB
        )
      `);
       //в будущем 
      await client.query(`
        CREATE TABLE IF NOT EXISTS failures (
          id SERIAL PRIMARY KEY,
          equipment_id INT REFERENCES equipment(id),
          date DATE NOT NULL,
          failure_description TEXT NOT NULL,
          repair_date DATE,
          repaired_by INT REFERENCES staff(id),
          status VARCHAR(50) CHECK (status IN ('Ожидание', 'В работе', 'Исправлено'))
        )
      `);
       //в будущем 
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_schedule (
          id SERIAL PRIMARY KEY,
          equipment_id INT REFERENCES equipment(id),
          scheduled_date DATE NOT NULL,
          maintenance_type VARCHAR(255) NOT NULL,
          assigned_to INT REFERENCES staff(id),
          status VARCHAR(50) CHECK (status IN ('Запланировано', 'Выполнено', 'Просрочено'))
        )
      `);
       //в будущем 
      await client.query(`
        CREATE TABLE IF NOT EXISTS spare_parts (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          quantity INT DEFAULT 0,
          unit VARCHAR(50)
        )
      `);
       //в будущем 
      await client.query(`
        CREATE TABLE IF NOT EXISTS maintenance_spare_parts (
          id SERIAL PRIMARY KEY,
          maintenance_id INT REFERENCES maintenance(id) ON DELETE CASCADE,
          spare_part_id INT REFERENCES spare_parts(id) ON DELETE CASCADE,
          quantity_used INT NOT NULL
        )
      `);

  
      
      
      await client.query('COMMIT');
      console.log('Таблицы успешно созданы');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Ошибка создания таблиц:', err);
      throw err;
    } finally {
      client.release();
    }
  }
  async function seedInitialData() {
    const client = await pool.connect();
    try {
     
      const { rows } = await client.query('SELECT COUNT(*) FROM equipment');
      if (rows[0].count > 0) return;
      
      console.log('Добавление тестовых данных...');
      await client.query('BEGIN');
      
       // Добавляем модели
    await client.query(`
        INSERT INTO models (name) VALUES 
        ('5008s'), ('Granumix 107s'), ('ВЭМ-150-Масса-К (А3)')
        ON CONFLICT (name) DO NOTHING
      `);
      
      // Добавляем локации
      await client.query(`
        INSERT INTO locations (name) VALUES 
        ('Малый зал'), ('Большой зал'), ('Техническое помещение')
        ON CONFLICT (name) DO NOTHING
      `);
      
      // Добавляем персонал
      await client.query(`
        INSERT INTO staff (full_name, position) VALUES
        ('Иванов Иван Иванович', 'Инженер'),
        ('Петрова Мария Сергеевна', 'Техник')
        ON CONFLICT DO NOTHING
      `);
      
      // Добавляем оборудование
      await client.query(`
        INSERT INTO equipment (name, model_id, quantity, location_id, description)
        SELECT 
          'Система гемодиализа' as name,
          m.id as model_id,
          6 as quantity,
          l.id as location_id,
          'Основные аппараты для гемодиализа' as description
        FROM models m, locations l
        WHERE m.name = '5008s' AND l.name = 'Малый зал'
        ON CONFLICT DO NOTHING
      `);
     
      
      
      
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Ошибка добавления тестовых данных:', err);
    } finally {
      client.release();
    }
  }
  app.get('/staff', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM staff ORDER BY full_name');
      res.render('staff/list', { 
        staff: rows,
        csrfToken: req.csrfToken?.(),
        currentPage: 'staff' 
      });
    } catch (err) {
      console.error('Ошибка при получении списка сотрудников:', err);
      res.status(500).render('error', { 
        message: 'Не удалось загрузить список сотрудников',
        currentPage: 'staff'
      });
    }
  });
  
  // Показать форму добавления сотрудника
  app.get('/staff/add', (req, res) => {
    res.render('staff/add', {
      csrfToken: req.csrfToken?.() 
    });
  });
  app.get('/staff/edit/:id', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.id]);
      
      if (rows.length === 0) {
        return res.status(404).render('error', { message: 'Сотрудник не найден' });
      }
      
      res.render('staff/edit', { 
        staff: rows[0]
      });
    } catch (err) {
      console.error(err);
      res.status(500).render('error', { message: 'Ошибка загрузки формы' });
    }
  });
  
  app.post('/staff/add', async (req, res) => {
  const { full_name, position } = req.body;
  
  if (!full_name || !position) {
    return res.status(400).render('error', { 
      message: 'ФИО и должность обязательны для заполнения',
      currentPage: 'staff'
    });
  }

  try {
    await pool.query(
      'INSERT INTO staff (full_name, position) VALUES ($1, $2)',
      [full_name, position]
    );
    res.redirect('/staff');
  } catch (err) {
    console.error('Ошибка при добавлении сотрудника:', err);
    res.status(500).render('error', { 
      message: 'Ошибка добавления сотрудника',
      currentPage: 'staff'
    });
  }
});

  app.post('/staff/edit/:id', async (req, res) => {
  const { id } = req.params;  // Получаем id из URL
  const { name, position, location_id, model_id } = req.body;  // Получаем данные из формы

  // Проверка на валидность данных 
  if (!name || !position || !location_id || !model_id) {
    return res.status(400).render('staff/edit', {
      staff: { id, name, position, location_id, model_id },
      error: 'Все поля должны быть заполнены'
    });
  }

  try {
    
    await pool.query(
      `UPDATE staff SET name = $1, position = $2, location_id = $3, model_id = $4 WHERE id = $5`,
      [name, position, location_id, model_id, id]
    );

    res.redirect(`/staff/${id}`);
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка при сохранении данных' });
  }
});

// Маршрут для печати списка всех сотрудников
app.get('/staff/print-all', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM staff ORDER BY full_name');
    res.render('staff/print-all', { 
      staffList: rows,
      currentPage: 'staff',
      printDate: new Date().toLocaleDateString('ru-RU')
    });
  } catch (err) {
    console.error('Ошибка при загрузке списка сотрудников для печати:', err);
    res.status(500).render('error', { 
      message: 'Ошибка загрузки данных',
      currentPage: 'staff'
    });
  }
});
app.get('/maintenance', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.date, m.maintenance_type, m.work_description, 
             m.spare_parts, m.decision, m.performed_by,
             e.name as equipment_name,
             mo.name as model_name
      FROM maintenance m
      LEFT JOIN equipment e ON m.equipment_id = e.id
      LEFT JOIN models mo ON e.model_id = mo.id
      ORDER BY m.date DESC
    `);
    res.render('maintenance/list', { 
      maintenance: rows,
      currentPage: 'maintenance',
      formatDate
    });
  } catch (err) {
    console.error('Ошибка при загрузке ТО:', err);
    res.status(500).render('error', { message: 'Ошибка загрузки данных ТО' });
  }
});

app.get('/maintenance/add', async (req, res) => {
  try {
    const [equipment, models, staff] = await Promise.all([
      pool.query('SELECT id, name FROM equipment'),
      pool.query('SELECT id, name FROM models'),
      pool.query('SELECT id, full_name FROM staff')
    ]);
    
    res.render('maintenance/add', { 
      equipment: equipment.rows,
      models: models.rows,
      staff: staff.rows,
      currentPage: 'add-maintenance'
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка загрузки формы' });
  }
});


app.post('/maintenance/add', async (req, res) => {
  const { equipment_id, date, maintenance_type, 
          work_description, spare_parts, decision, performed_by } = req.body;
  
  // Проверка обязательных полей
  if (!equipment_id || !date || !maintenance_type || !work_description || !performed_by) {
    const [equipment, models, staff] = await Promise.all([
      pool.query('SELECT id, name FROM equipment'),
      pool.query('SELECT id, name FROM models'),
      pool.query('SELECT id, full_name FROM staff')
    ]);
    
    return res.render('maintenance/add', {
      equipment: equipment.rows,
      models: models.rows,
      staff: staff.rows,
      error: 'Заполните все обязательные поля',
      formData: req.body
    });
  }

  try {
    await pool.query(
      `INSERT INTO maintenance 
       (equipment_id, date, maintenance_type, work_description, 
        spare_parts, decision, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        equipment_id, 
        date, 
        maintenance_type, 
        work_description, 
        spare_parts || null, 
        decision || null, 
        performed_by
      ]
    );
    res.redirect('/maintenance');
  } 
    catch (err) {
    console.error('Ошибка добавления ТО:', err);
    
    const [equipment, models, staff] = await Promise.all([
      pool.query('SELECT id, name FROM equipment'),
      pool.query('SELECT id, name FROM models'),
      pool.query('SELECT id, full_name FROM staff')
    ]);
    
    res.render('maintenance/add', {
      equipment: equipment.rows,
      models: models.rows,
      staff: staff.rows,
      error: `Ошибка добавления ТО: ${err.message}`,
      formData: req.body
    });
  }
  
});

app.get('/maintenance/edit/:id', async (req, res) => {
  try {
    const [maintenance, equipment, staff] = await Promise.all([
      pool.query('SELECT * FROM maintenance WHERE id = $1', [req.params.id]),
      pool.query('SELECT id, name FROM equipment'),
      pool.query('SELECT id, full_name, position FROM staff')
    ]);
    
    if (maintenance.rows.length === 0) {
      return res.status(404).render('error', { 
        message: 'Запись ТО не найдена',
        currentPage: 'maintenance'
      });
    }
    
    res.render('maintenance/edit', { 
      maintenance: maintenance.rows[0],
      equipment: equipment.rows,
      staff: staff.rows,
      currentPage: 'maintenance'
    });
  } catch (err) {
    console.error('Ошибка при загрузке формы редактирования ТО:', err);
    res.status(500).render('error', { 
      message: 'Ошибка загрузки формы',
      currentPage: 'maintenance'
    });
  }
});


app.post('/maintenance/edit/:id', async (req, res) => {
  const { equipment_id, date, maintenance_type, 
          work_description, spare_parts, decision, performed_by } = req.body;
  const id = req.params.id;

  try {
 
    const checkResult = await pool.query('SELECT id FROM maintenance WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).render('error', {
        message: 'Запись ТО не найдена',
        currentPage: 'maintenance'
      });
    }

    await pool.query(
      `UPDATE maintenance SET
       equipment_id = $1, date = $2, maintenance_type = $3, 
       work_description = $4, spare_parts = $5, decision = $6, 
       performed_by = $7
       WHERE id = $8`,
      [
        equipment_id, 
        date, 
        maintenance_type, 
        work_description, 
        spare_parts || null, 
        decision || null, 
        performed_by,
        id
      ]
    );
    res.redirect('/maintenance');
  } catch (err) {
    console.error('Ошибка при обновлении ТО:', err);
    
    try {
      const [equipment, staff] = await Promise.all([
        pool.query('SELECT id, name FROM equipment'),
        pool.query('SELECT id, full_name, position FROM staff')
      ]);
      
      res.render('maintenance/edit', {
        maintenance: { 
          id,
          equipment_id,
          date,
          maintenance_type,
          work_description,
          spare_parts,
          decision,
          performed_by
        },
        equipment: equipment.rows,
        staff: staff.rows,
        error: 'Ошибка обновления ТО',
        currentPage: 'maintenance'
      });
    } catch (fetchErr) {
      console.error('Ошибка при получении данных для формы:', fetchErr);
      res.status(500).render('error', {
        message: 'Ошибка при обработке запроса',
        currentPage: 'maintenance'
      });
    }
  }
});

// Удаление ТО
app.post('/maintenance/delete/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM maintenance WHERE id = $1', [req.params.id]);
    res.redirect('/maintenance');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Ошибка удаления ТО' });
  }
});
// Маршрут для печати ТО
app.get('/maintenance/print/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, 
             e.name as equipment_name,
             mo.name as model_name,
             l.name as location_name
      FROM maintenance m
      LEFT JOIN equipment e ON m.equipment_id = e.id
      LEFT JOIN models mo ON e.model_id = mo.id
      LEFT JOIN locations l ON e.location_id = l.id
      WHERE m.id = $1
    `, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).render('error', { 
        message: 'Запись ТО не найдена',
        currentPage: 'maintenance'
      });
    }
    
    res.render('maintenance/print', { 
      item: rows[0],
      formatDate,
      currentPage: 'maintenance'
    });
  } catch (err) {
    console.error('Ошибка при загрузке ТО для печати:', err);
    res.status(500).render('error', { 
      message: 'Ошибка загрузки данных',
      currentPage: 'maintenance'
    });
  }
});

  async function startServer() {
    try {
      // Проверка подключения
      const checkClient = await pool.connect();
      await checkClient.query('SELECT 1');
      checkClient.release();
      console.log('Подключение к PostgreSQL успешно');
      
      // Создание таблиц
      await createTables();
      
      // Добавление тестовых данных
      await seedInitialData();
      
      // Проверка существования таблиц
      await checkDatabaseStructure();
      
      // Запуск сервера
      app.listen(port, () => {
        console.log(`Сервер запущен на порту ${port}`);
        console.log(`Доступно по адресу: http://localhost:${port}`);
      });
    } catch (err) {
      console.error('Ошибка запуска сервера:', err);
      process.exit(1);
    }
  }
  
  startServer();