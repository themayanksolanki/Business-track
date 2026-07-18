import Tag from '../models/Tag.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import ProjectItem from '../models/ProjectItem.js';
import AppError from '../utils/AppError.js';

const sameOrg = (a, b) => String(a ?? '') === String(b ?? '');

export const getTags = async (req, res, next) => {
  try {
    const tags = await Tag.find({ organization: req.user.organization }).sort({ name: 1 });
    const tagIds = tags.map((t) => t._id);

    const [projectCounts, taskCounts, itemCounts] = await Promise.all([
      Project.aggregate([
        { $match: { tags: { $in: tagIds } } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: { tags: { $in: tagIds } } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
      ]),
      ProjectItem.aggregate([
        { $match: { tags: { $in: tagIds } } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
      ]),
    ]);

    const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.count]));
    const projectCountMap = toMap(projectCounts);
    const taskCountMap = toMap(taskCounts);
    const itemCountMap = toMap(itemCounts);

    const withCounts = tags.map((t) => ({
      ...t.toObject(),
      projectCount: projectCountMap.get(String(t._id)) ?? 0,
      taskCount: (taskCountMap.get(String(t._id)) ?? 0) + (itemCountMap.get(String(t._id)) ?? 0),
    }));

    res.status(200).json(withCounts);
  } catch (err) {
    next(err);
  }
};

export const createTag = async (req, res, next) => {
  try {
    const { name, textColor, backgroundColor } = req.body;

    const tag = await Tag.create({
      name: name.trim(),
      textColor,
      backgroundColor,
      organization: req.user.organization,
      createdBy: req.user._id,
    });

    res.status(201).json({ message: 'Tag created', tag });
  } catch (err) {
    if (err.code === 11000) return next(new AppError('A tag with this name already exists', 409));
    next(err);
  }
};

export const updateTag = async (req, res, next) => {
  try {
    const tag = await Tag.findById(req.params.id);
    if (!tag || !sameOrg(tag.organization, req.user.organization))
      return next(new AppError('Tag not found', 404));

    const { name, textColor, backgroundColor } = req.body;
    if (name !== undefined) tag.name = name.trim();
    if (textColor !== undefined) tag.textColor = textColor;
    if (backgroundColor !== undefined) tag.backgroundColor = backgroundColor;
    tag.updatedBy = req.user._id;

    await tag.save();
    res.status(200).json({ message: 'Tag updated', tag });
  } catch (err) {
    if (err.code === 11000) return next(new AppError('A tag with this name already exists', 409));
    next(err);
  }
};

export const deleteTag = async (req, res, next) => {
  try {
    const tag = await Tag.findById(req.params.id);
    if (!tag || !sameOrg(tag.organization, req.user.organization))
      return next(new AppError('Tag not found', 404));

    const id = tag._id;
    await Promise.all([
      Project.updateMany({ tags: id }, { $pull: { tags: id } }),
      Task.updateMany({ tags: id }, { $pull: { tags: id } }),
      ProjectItem.updateMany({ tags: id }, { $pull: { tags: id } }),
    ]);
    await Tag.findByIdAndDelete(id);

    res.status(200).json({ message: 'Tag deleted' });
  } catch (err) {
    next(err);
  }
};
