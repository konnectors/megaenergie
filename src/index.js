const {
  BaseKonnector,
  requestFactory,
  log,
  normalizeFilename,
  errors
} = require('cozy-konnector-libs')

const moment = require('moment')

const request = requestFactory({
  // debug: true,
  cheerio: false,
  json: true,
  jar: false
})

const VENDOR = 'Mega Energie'
const baseUrl = 'https://microservices.mega-energie.fr'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
// cozyParameters are static parameters, independents from the account. Most often, it can be a
// secret api key.
async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  await authenticate.bind(this)(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const contracts = await request(
    `${baseUrl}/private/espace-client/${fields.login}/contracts`,
    request.options
  )
  log('info', `Number of contracts: ${contracts.length}`)

  const docsPromises = []
  for (var contractId in contracts) {
    log(
      'info',
      `Fetching ${contracts[contractId].energy} invoices from contract ${contracts[contractId].id}`
    )
    docsPromises.push(getContractInfo(fields.login, contracts[contractId]))
  }

  const docsArrays = await Promise.all(docsPromises)
  const documents = []

  docsArrays.forEach(arr => {
    arr.forEach(doc => documents.push(doc))
  })

  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  await this.saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['Mega Energie']
  })
}

// This shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
async function authenticate(username, password) {
  try {
    const response = await request.post(`${baseUrl}/public/customer/v1/login`, {
      json: true,
      body: {
        username: username,
        password: password
      }
    })

    log('debug', response, 'Authentification response')

    // request.headers = { authorization: `Bearer ${response.token}` }
    request.options = {
      headers: {
        authorization: `Bearer ${response.token}`
      }
    }
  } catch (err) {
    if (err.response.body.error) {
      log('error', err.response.body.error)
    }
    if (err.response.statusCode === 400) {
      throw new Error(errors.LOGIN_FAILED)
    }
    throw err
  }
}

async function getContractInfo(login, contract) {
  const invoices = await request(
    `${baseUrl}/private/espace-client/${login}/contracts/${contract.id}/invoices`,
    request.options
  )
  const result = invoices.map(doc => {
    const date = moment(doc.date)
    return {
      amount: doc.vatIncludedAmount,
      contractId: contract.id,
      contractLabel: `${contract.energy}_${contract.id}`,
      currency: 'EUR',
      date: date.toDate(),
      docid: doc.number,
      filename: normalizeFilename(
        `${date.format('YYYYMMDD')}_${doc.number}_${doc.vatIncludedAmount}EUR`,
        'pdf'
      ),
      fileurl: `${baseUrl}/private/espace-client/${login}/files?file=${doc.pdf}`,
      vendor: VENDOR,
      requestOptions: request.options
    }
  })
  if (result) {
    log(
      'debug',
      result,
      `Contract ${contract.id}: ${result.length} document(s)`
    )
  }
  return result
}
