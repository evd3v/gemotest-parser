const fs = require('fs')
const axios = require('axios')
const cheerio = require('cheerio')

const { performance } = require('perf_hooks')
const { is } = require('cheerio/lib/api/traversing')

const baseUrl = 'https://gemotest.ru'

const getCategories = async () => {
  const { data: html } = await axios.get(`${baseUrl}/moskva/catalog/`)
  let $ = cheerio.load(html)

  const categoriesList = []

  const list = $(html).find('#services-list').children()

  list.each((index, element, array) => {
    // убираем раздел "Часто ищут", т.к это не категория
    if (index > 2) {
      if (index % 2 === 0) {
        const subcategories = []

        // собираем подкатегории
        $(element)
          .find('.caption a')
          .each((index, element) => {
            subcategories.push({
              name: $(element).text().trim(),
              link: `${baseUrl}${$(element).attr('href')}`,
            })
          })

        // формируем список категорий с подкатегориями
        categoriesList.push({
          name: $(list[index - 1])
            .text()
            .trim(),
          subcategories,
        })
      }
    }
  })

  return categoriesList
}

const getAnalysis = async (subcategory) => {
  try {
    const startTime = performance.now()

    const { data: html } = await axios.get(subcategory.link)

    const endTime = performance.now()

    analysisCount += 1
    console.info(`load ${analysisCount} analysis by ${endTime - startTime}`)

    let $ = cheerio.load(html)

    const analysis = []

    $(html)
      .find('.diag .item')
      .each((index, element) => {
        let rawId = $(element).attr('id')

        if (rawId) {
          const id = rawId.replace(/\D/g, '')
          const link = `${baseUrl}${$(element).find('.title a').attr('href')}`
          const name = $(element).find('.title a').text().trim()

          analysis.push({
            id,
            link,
            name,
          })
        }
      })

    return analysis
  } catch (e) {
    console.log(e)
    console.error(subcategory.link)
  }
}

const getSubSubcategories = async (subcategory) => {
  try {
    const { data: html } = await axios.get(subcategory.link)
    let $ = cheerio.load(html)

    const subSubcategories = []

    const items = $(html).find('.issue > .list li')

    if (items) {
      items.each((index, element) => {
        if ($(element).find('a').attr('href').includes('#')) {
          return false
        }

        const link = `${baseUrl}${$(element).find('a').attr('href')}`
        const name = $(element).find('a').text().trim()

        subSubcategories.push({
          link,
          name,
        })
      })
    }

    return subSubcategories
  } catch (e) {
    console.log(e.response)
  }
}

const getAnalysisData = async (analysis) => {
  const startTime = performance.now()

  const { data: html } = await axios.get(analysis.link)
  let $ = cheerio.load(html)

  analysisDataCount += 1

  const endTIme = performance.now()

  console.info(`load ${analysisDataCount} data of ${analysisCount} analysis by ${endTIme - startTime}`)

  const code = $(html).find('.analize_info > span').first().text().trim()

  const summary = $(html).find('.article > .issue > p').text().trim()

  const description = generateAnalysisDescription($, $(html).find('#descr_title').nextAll())

  const purpose = $(html).find('#when_title').next().text().trim()

  const prepare = $(html).find('#prepare_title').next().text().trim()

  const restrictions = $(html).find('#restrict_title').next().text().trim()

  const interpretation = $(html).find('.INTERPRETING_RESULT_value').text().trim()

  const unit = $(html).find('#UNIT_title').next().text().trim()

  const referenceValue = $(html).find('#REFERENCE_VALUES_title').next().text().trim()

  return {
    code,
    summary,
    description,
    purpose,
    prepare,
    restrictions,
    interpretation,
    unit,
    referenceValue,
  }
}

const generateAnalysisDescription = ($, nodes) => {
  let description = ''

  nodes.each((index, el) => {
    const element = $(el)
    const tagName = element[0].tagName || element[0].name

    if (tagName === 'hr') {
      return false
    }

    description += $(el).text().trim()
  })

  return description
}

let analysisCount = 0
let analysisDataCount = 0

;(async function () {
  const startTime = performance.now()

  console.log('script started: ', startTime)

  const categories = await getCategories()

  for await (const [catIndex, category] of categories.entries()) {
    for await (const [subIndex, subcategory] of category.subcategories.entries()) {
      const subSubcategories = await getSubSubcategories(subcategory)

      if (subSubcategories.length) {
        for await (const [subSubcategoryIndex, subSubcategory] of subSubcategories.entries()) {
          const analysis = await getAnalysis(subSubcategory)

          if (!analysis) {
            throw new Error()
          }

          subSubcategories[subSubcategoryIndex] = {
            ...subSubcategory,
            analysis,
          }
        }

        categories[catIndex].subcategories[subIndex] = {
          ...subcategory,
          subSubcategories,
        }
      } else {
        const analysis = await getAnalysis(subcategory)
        if (!analysis) {
          throw new Error()
        }
        categories[catIndex].subcategories[subIndex] = {
          ...subcategory,
          analysis,
        }
      }
    }
  }

  for await (const [catIndex, category] of categories.entries()) {
    for await (const [subIndex, subcategory] of category.subcategories.entries()) {
      if (subcategory.analysis) {
        for await (const [analysisIndex, analysis] of subcategory.analysis.entries()) {
          const analysisData = await getAnalysisData(analysis)
          categories[catIndex].subcategories[subIndex].analysis[analysisIndex] = { ...analysis, ...analysisData }
        }
      } else if (subcategory.subSubcategories) {
        for await (const [subSubcategoryIndex, subSubcategory] of subcategory.subSubcategories.entries()) {
          for await (const [analysisIndex, analysis] of subSubcategory.analysis.entries()) {
            const analysisData = await getAnalysisData(analysis)

            categories[catIndex].subcategories[subIndex].subSubcategories[subSubcategoryIndex].analysis[analysisIndex] = {
              ...analysis,
              ...analysisData,
            }
          }
        }
      }
    }
  }

  const mappedAnalysis = []

  for (const [catIndex, category] of categories.entries()) {
    for (const [subIndex, subcategory] of category.subcategories.entries()) {
      if (subcategory.analysis) {
        for (const [analysisIndex, analysis] of subcategory.analysis.entries()) {
          mappedAnalysis.push({ category: category.name, subcategory: subcategory.name, subSubCategory: null, ...analysis })
        }
      } else if (subcategory.subSubcategories) {
        for (const [subSubCategoryIndex, subSubCategory] of subcategory.subSubcategories.entries()) {
          for (const [analysisIndex, analysis] of subSubCategory.analysis.entries()) {
            mappedAnalysis.push({ category: category.name, subcategory: subcategory.name, subSubCategory: subSubCategory.name, ...analysis })
          }
        }
      }
    }
  }

  fs.writeFile('gemotest.json', JSON.stringify(mappedAnalysis), (err) => {
    if (err) {
      console.log(err)
      return
    }

    const endTime = performance.now()

    console.log('script ended: ', endTime)
  })
})()
