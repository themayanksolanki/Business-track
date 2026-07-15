import ProjectItem from '../models/ProjectItem.js';
import Comment from '../models/Comment.js';
import AppError from '../utils/AppError.js';

export const getComments = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const comments = await Comment.find({ projectItem: item._id })
      .populate('author', 'username email role')
      .sort({ createdAt: 1 });

    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
};

export const createComment = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const comment = await Comment.create({
      projectItem: item._id,
      author: req.user._id,
      body: req.body.body.trim(),
    });

    const populated = await comment.populate('author', 'username email role');
    res.status(201).json({ message: 'Comment added', comment: populated });
  } catch (err) {
    next(err);
  }
};

export const deleteComment = async (req, res, next) => {
  try {
    const comment = await Comment.findOne({
      _id: req.params.commentId,
      projectItem: req.params.itemId,
    });
    if (!comment) return next(new AppError('Comment not found', 404));

    if (String(comment.author) !== String(req.user._id))
      return next(new AppError('You can only delete your own comments', 403));

    await Comment.findByIdAndDelete(comment._id);
    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};
