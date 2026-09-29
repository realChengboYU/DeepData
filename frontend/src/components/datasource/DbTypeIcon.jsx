import pgIcon from '../../assets/ds/pg.svg'
import mysqlIcon from '../../assets/ds/mysql.svg'
import sqliteIcon from '../../assets/ds/sqlite.svg'

// 数据库类型（当前只支持 PostgreSQL，其余为占位，供后续扩展）
export const DB_TYPES = [
  { id: 'postgresql', name: 'PostgreSQL', available: true, descKey: 'ds.relation' },
  { id: 'mysql', name: 'MySQL', available: false, descKey: 'ds.relation' },
  { id: 'sqlite', name: 'SQLite', available: false, descKey: 'ds.embedded' },
]

// 各数据库品牌图标（按类型选用，取代通用圆柱体）
const DB_ICONS = { postgresql: pgIcon, mysql: mysqlIcon, sqlite: sqliteIcon }

export function DbTypeIcon({ type = 'postgresql', size = 24, className }) {
  return <img src={DB_ICONS[type] || pgIcon} width={size} height={size} className={className} alt="" aria-hidden="true" />
}
