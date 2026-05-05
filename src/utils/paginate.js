const paginate = async (model, pipeline, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const result = await model.aggregate([
    ...pipeline,
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: parseInt(limit) }],
        totalCount: [{ $count: "count" }]
      }
    }
  ]);

  const data = result[0].data;
  const total = result[0].totalCount[0] ? result[0].totalCount[0].count : 0;
  const pages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1
    }
  };
};

export default paginate;
