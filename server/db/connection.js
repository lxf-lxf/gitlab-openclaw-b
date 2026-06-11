import { Sequelize } from 'sequelize'
import config from '../config.js'

const sequelize = new Sequelize(config.db.database, config.db.user, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  logging: false,
  retry: {
    max: 3,
    match: [
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeInvalidConnectionError/,
      /SequelizeConnectionTimedOutError/,
      /ETIMEDOUT/,
      /ECONNREFUSED/
    ]
  },
  dialectOptions: {
    connectTimeout: 10000
  },
  define: {
    timestamps: true,
    underscored: false,
    freezeTableName: true
  },
  pool: {
    max: 10,
    min: 2,
    acquire: 60000,
    idle: 5000,
    evict: 10000
  }
})

export default sequelize
